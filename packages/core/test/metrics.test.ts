import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIST_BINS, MetricsAggregator, type MetricRow, binFor, binValue, mergeHistograms, percentileFromHistogram } from '../src/lib/metrics.js';

afterEach(() => vi.useRealTimers());

describe('latency histograms', () => {
  it('puts sub-millisecond and bad values in bin 0 and caps the top', () => {
    expect(binFor(0.2)).toBe(0);
    expect(binFor(Number.NaN)).toBe(0);
    expect(binFor(1)).toBe(1);
    expect(binFor(1e12)).toBe(HIST_BINS - 1);
    expect(binValue(0)).toBe(0.5);
  });

  it('reads percentiles back within one bin (20%)', () => {
    const h = new Array(HIST_BINS).fill(0);
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000]) h[binFor(ms)]++;
    expect(percentileFromHistogram(h, 0.5)!).toBeGreaterThan(50 / 1.2);
    expect(percentileFromHistogram(h, 0.5)!).toBeLessThan(50 * 1.2);
    expect(percentileFromHistogram(h, 0.99)!).toBeGreaterThan(1000 / 1.2);
    expect(percentileFromHistogram(new Array(HIST_BINS).fill(0), 0.5)).toBeNull();
    // A q above 1 still lands on the last populated bin.
    expect(percentileFromHistogram([0, 1], 2)).toBe(binValue(1));
  });

  it('merges histograms of different lengths', () => {
    expect(mergeHistograms([1, 2], [3])).toEqual([4, 2]);
  });
});

describe('MetricsAggregator', () => {
  const at = (iso: string) => Date.parse(iso);

  it('buckets by minute and label, counting errors, and only drains finished minutes', async () => {
    let now = at('2026-09-27T10:00:10Z');
    const written: MetricRow[][] = [];
    const m = new MetricsAggregator(async (rows) => void written.push(rows), () => now);
    m.record('route', 'explore', 400);
    m.record('route', 'explore', 1600, true);
    m.record('route', 'fastest', 50);
    await m.flush();
    expect(written).toHaveLength(0);
    now = at('2026-09-27T10:01:05Z');
    m.record('route', 'explore', 10);
    await m.flush();
    expect(written[0]!.map((r) => [r.label, r.count, r.errorCount, r.maxMs, r.sumMs])).toEqual([
      ['explore', 2, 1, 1600, 2000],
      ['fastest', 1, 0, 50, 50],
    ]);
    await m.flush(true);
    expect(written[1]!.map((r) => [r.label, r.count, r.bucketStart.toISOString()])).toEqual([['explore', 1, '2026-09-27T10:01:00.000Z']]);
  });

  it('times async work and records failures as errors, rethrowing them', async () => {
    const m = new MetricsAggregator(async () => undefined);
    await expect(m.time('job', 'ok', async () => 42)).resolves.toBe(42);
    await expect(m.time('job', 'bad', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    const rows = m.drain(true);
    expect(rows.map((r) => [r.label, r.count, r.errorCount])).toEqual([['ok', 1, 0], ['bad', 1, 1]]);
  });

  it('keeps rows when a write fails and merges them into the next flush', async () => {
    let fail = true;
    const written: MetricRow[] = [];
    let now = at('2026-09-27T10:00:10Z');
    const m = new MetricsAggregator(async (rows) => {
      if (fail) throw new Error('db down');
      written.push(...rows);
    }, () => now);
    m.record('http.request', 'GET /api/search', 20);
    await m.flush(true);
    expect(written).toHaveLength(0);
    // Same minute and label again: merged with the kept row.
    m.record('http.request', 'GET /api/search', 80, true);
    now = at('2026-09-27T10:00:20Z');
    await m.flush(true);
    m.record('http.request', 'GET /api/search', 5);
    fail = false;
    await m.flush(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ count: 3, errorCount: 1, sumMs: 105, maxMs: 80 });
    expect(written[0]!.histogram.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('flushes on a timer and everything on stop', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const m = new MetricsAggregator(write);
    m.start(1000);
    m.start(1000); // idempotent
    m.record('job', 'x', 1);
    await vi.advanceTimersByTimeAsync(1000);
    // The minute isn't over yet, so nothing is written by the timer.
    expect(write).not.toHaveBeenCalled();
    await m.stop();
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
