import type { MetricPoint } from '@wayfinder/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeBuckets } from '../src/admin/pages/metrics-util';
import { currentPosition } from '../src/lib/geolocation';
import { formatBytes, formatDate, formatMs, formatNumber, formatRelative } from '../src/lib/format';

afterEach(() => vi.useRealTimers());

describe('format', () => {
  it('formats relative times, mid-sentence or not', () => {
    vi.useFakeTimers({ now: new Date('2026-09-27T12:00:00Z') });
    expect(formatRelative(null)).toBe('Never');
    expect(formatRelative(null, { midSentence: true })).toBe('never');
    expect(formatRelative('2026-09-27T11:59:30Z')).toBe('Just now');
    expect(formatRelative('2026-09-27T11:59:30Z', { midSentence: true })).toBe('just now');
    expect(formatRelative('2026-09-27T11:15:00Z')).toBe('45 min ago');
    expect(formatRelative('2026-09-27T07:00:00Z')).toBe('5 h ago');
    expect(formatRelative('2026-09-24T12:00:00Z')).toBe('3 d ago');
    expect(formatRelative('2026-08-01T12:00:00Z')).toBe(formatDate('2026-08-01T12:00:00Z'));
  });

  it('formats bytes, durations and numbers', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 ** 2)).toBe('50 MB');
    expect(formatBytes(3 * 1024 ** 5)).toBe('3072 TB');
    expect(formatMs(null)).toBe('–');
    expect(formatMs(12.4)).toBe('12 ms');
    expect(formatMs(2345)).toBe('2.3 s');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

describe('mergeBuckets', () => {
  const p = (bucket: string, count: number, p50: number | null, p95: number | null, errorCount = 0): MetricPoint =>
    ({ bucket, label: 'x', count, errorCount, p50Ms: p50, p95Ms: p95 }) as MetricPoint;

  it('combines labels per bucket: weighted p50, max p95, error share; sorted by time', () => {
    const out = mergeBuckets([p('2026-09-27T02:00Z', 1, 10, 20), p('2026-09-27T01:00Z', 3, 100, 400, 3), p('2026-09-27T01:00Z', 1, 200, 300), p('2026-09-27T01:00Z', 2, null, null)]);
    expect(out.map((b) => b.bucket)).toEqual(['2026-09-27T01:00Z', '2026-09-27T02:00Z']);
    expect(out[0]).toMatchObject({ count: 6, errors: 3, errorPct: 50, p50: 125, p95: 400 });
    expect(out[1]).toMatchObject({ count: 1, p50: 10, p95: 20, errorPct: 0 });
  });
});

describe('currentPosition', () => {
  const stub = (impl: Geolocation['getCurrentPosition']) =>
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: impl }, configurable: true });
  afterEach(() => {
    delete (navigator as { geolocation?: unknown }).geolocation;
  });

  it('resolves [lon, lat]', async () => {
    stub((ok) => ok({ coords: { longitude: 153, latitude: -27.5 } } as GeolocationPosition));
    await expect(currentPosition()).resolves.toEqual([153, -27.5]);
  });

  it('explains a refusal and other failures', async () => {
    stub((_ok, fail) => fail!({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError));
    await expect(currentPosition()).rejects.toThrow('Location permission was denied');
    stub((_ok, fail) => fail!({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError));
    await expect(currentPosition()).rejects.toThrow('Couldn’t get your location');
  });

  it('says so when the browser has no location at all', async () => {
    await expect(currentPosition()).rejects.toThrow('Location is not available in this browser');
  });
});
