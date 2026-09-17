import type { MetricPoint } from '@wayfinder/shared';

export interface MergedBucket extends Record<string, unknown> {
  bucket: string;
  count: number;
  errors: number;
  errorPct: number;
  p50: number | null;
  p95: number | null;
}

/** Combine per-label points into one row per time bucket. */
export function mergeBuckets(points: MetricPoint[]): MergedBucket[] {
  const map = new Map<string, MergedBucket>();
  for (const p of points) {
    const b = map.get(p.bucket) ?? { bucket: p.bucket, count: 0, errors: 0, errorPct: 0, p50: null, p95: null };
    b.p50 = p.p50Ms === null ? b.p50 : b.p50 === null ? p.p50Ms : (b.p50 * b.count + p.p50Ms * p.count) / (b.count + p.count);
    b.count += p.count;
    b.errors += p.errorCount;
    b.p95 = p.p95Ms === null ? b.p95 : Math.max(b.p95 ?? 0, p.p95Ms);
    b.errorPct = b.count ? (b.errors / b.count) * 100 : 0;
    map.set(p.bucket, b);
  }
  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}
