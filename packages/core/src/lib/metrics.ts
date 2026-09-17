import type { DbClient } from '../db/pool.js';

export const HIST_BINS = 64;
const BASE = 1.2;
const LOG_BASE = Math.log(BASE);

/** Histogram bin for a duration: bin 0 is < 1 ms, then log-scale with ratio 1.2. */
export function binFor(ms: number): number {
  if (!(ms >= 1)) return 0;
  return Math.min(HIST_BINS - 1, 1 + Math.floor(Math.log(ms) / LOG_BASE));
}

/** Representative value (geometric midpoint) of a bin in ms. */
export function binValue(bin: number): number {
  if (bin === 0) return 0.5;
  return Math.sqrt(BASE ** (bin - 1) * BASE ** bin);
}

export function percentileFromHistogram(hist: readonly number[], q: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = Math.max(1, Math.ceil(total * q));
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i] ?? 0;
    if (seen >= target) return binValue(i);
  }
  return binValue(hist.length - 1);
}

export function mergeHistograms(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}

export interface MetricRow {
  bucketStart: Date;
  metric: string;
  label: string;
  count: number;
  errorCount: number;
  sumMs: number;
  maxMs: number;
  histogram: number[];
}

const MINUTE = 60_000;

/**
 * Collects request/job timings in memory per minute bucket and periodically flushes closed
 * buckets to Postgres. Labels must never contain ids, coordinates or other user data.
 */
export class MetricsAggregator {
  private buckets = new Map<string, MetricRow>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly write: (rows: MetricRow[]) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  record(metric: string, label: string, durationMs: number, isError = false): void {
    const bucketStart = Math.floor(this.now() / MINUTE) * MINUTE;
    const key = `${bucketStart}|${metric}|${label}`;
    let row = this.buckets.get(key);
    if (!row) {
      row = {
        bucketStart: new Date(bucketStart),
        metric,
        label,
        count: 0,
        errorCount: 0,
        sumMs: 0,
        maxMs: 0,
        histogram: new Array<number>(HIST_BINS).fill(0),
      };
      this.buckets.set(key, row);
    }
    row.count++;
    if (isError) row.errorCount++;
    row.sumMs += durationMs;
    row.maxMs = Math.max(row.maxMs, durationMs);
    row.histogram[binFor(durationMs)]!++;
  }

  /** Time an async operation; failures are recorded as errors and rethrown. */
  async time<T>(metric: string, label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.record(metric, label, performance.now() - start);
      return result;
    } catch (err) {
      this.record(metric, label, performance.now() - start, true);
      throw err;
    }
  }

  /** Remove and return buckets; by default only minutes that have finished. */
  drain(all = false): MetricRow[] {
    const currentMinute = Math.floor(this.now() / MINUTE) * MINUTE;
    const out: MetricRow[] = [];
    for (const [key, row] of this.buckets) {
      if (all || row.bucketStart.getTime() < currentMinute) {
        out.push(row);
        this.buckets.delete(key);
      }
    }
    return out;
  }

  async flush(all = false): Promise<void> {
    const rows = this.drain(all);
    if (rows.length === 0) return;
    try {
      await this.write(rows);
    } catch {
      // Put them back so the next flush retries.
      for (const r of rows) {
        const key = `${r.bucketStart.getTime()}|${r.metric}|${r.label}`;
        const existing = this.buckets.get(key);
        if (existing) {
          existing.count += r.count;
          existing.errorCount += r.errorCount;
          existing.sumMs += r.sumMs;
          existing.maxMs = Math.max(existing.maxMs, r.maxMs);
          existing.histogram = mergeHistograms(existing.histogram, r.histogram);
        } else this.buckets.set(key, r);
      }
    }
  }

  start(intervalMs = 15_000): void {
    this.timer ??= setInterval(() => void this.flush(), intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush(true);
  }
}

export function metricsWriter(db: DbClient) {
  return async (rows: MetricRow[]) => {
    for (const r of rows) {
      await db.query(
        `INSERT INTO metrics_minute
           (bucket_start, metric, label, count, error_count, sum_ms, p50_ms, p95_ms, max_ms, histogram)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (bucket_start, metric, label) DO UPDATE SET
           count = metrics_minute.count + EXCLUDED.count,
           error_count = metrics_minute.error_count + EXCLUDED.error_count,
           sum_ms = metrics_minute.sum_ms + EXCLUDED.sum_ms,
           max_ms = GREATEST(metrics_minute.max_ms, EXCLUDED.max_ms),
           histogram = (SELECT array_agg(coalesce(a, 0) + coalesce(b, 0))
                        FROM unnest(metrics_minute.histogram, EXCLUDED.histogram) AS t(a, b)),
           p50_ms = GREATEST(metrics_minute.p50_ms, EXCLUDED.p50_ms),
           p95_ms = GREATEST(metrics_minute.p95_ms, EXCLUDED.p95_ms)`,
        [
          r.bucketStart,
          r.metric,
          r.label,
          r.count,
          r.errorCount,
          r.sumMs,
          percentileFromHistogram(r.histogram, 0.5),
          percentileFromHistogram(r.histogram, 0.95),
          r.maxMs,
          r.histogram,
        ],
      );
    }
  };
}
