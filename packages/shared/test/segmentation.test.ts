import { describe, expect, it } from 'vitest';
import { destination } from '../src/geo.js';
import { type TrackPoint, filterPoints, inferMode, segmentTrips } from '../src/segmentation.js';

const T0 = Date.UTC(2026, 0, 1, 8);

/** Straight-line track heading east at speedMps with a fix every intervalS. */
function track(startTs: number, n: number, speedMps: number, intervalS = 5, start: [number, number] = [149.1, -35.28]): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const [lon, lat] = destination(start, 90, speedMps * intervalS * i);
    return { ts: startTs + i * intervalS * 1000, lon, lat, accuracyM: 10 };
  });
}

function stationary(startTs: number, minutes: number, at: [number, number]): TrackPoint[] {
  return Array.from({ length: minutes * 2 }, (_, i) => ({
    ts: startTs + i * 30_000,
    lon: at[0] + (i % 2) * 0.00005,
    lat: at[1],
    accuracyM: 15,
  }));
}

describe('filterPoints', () => {
  it('drops inaccurate points, duplicates and teleports; sorts by time', () => {
    const pts: TrackPoint[] = [
      { ts: T0 + 10_000, lon: 149.1001, lat: -35.28, accuracyM: 5 },
      { ts: T0, lon: 149.1, lat: -35.28, accuracyM: 5 },
      { ts: T0, lon: 149.1, lat: -35.28, accuracyM: 5 },
      { ts: T0 + 5000, lon: 149.1, lat: -35.28, accuracyM: 500 },
      { ts: T0 + 20_000, lon: 150.5, lat: -35.28, accuracyM: 5 }, // 120 km in 10 s
      { ts: T0 + 30_000, lon: 149.1002, lat: -35.28, accuracyM: null },
    ];
    const out = filterPoints(pts);
    expect(out.map((p) => p.ts)).toEqual([T0, T0 + 10_000, T0 + 30_000]);
  });
});

describe('segmentTrips', () => {
  it('splits on a long time gap', () => {
    const a = track(T0, 60, 10);
    const b = track(T0 + 3 * 3600_000, 60, 10, 5, [149.2, -35.3]);
    const trips = segmentTrips([...a, ...b]);
    expect(trips).toHaveLength(2);
    expect(trips[0]).toHaveLength(60);
  });

  it('splits on a long stop and discards the stationary points', () => {
    const a = track(T0, 60, 10); // 5 min driving ~3 km
    const end = a[a.length - 1]!;
    const stop = stationary(end.ts + 5000, 10, [end.lon, end.lat]);
    const b = track(stop[stop.length - 1]!.ts + 5000, 60, 10, 5, [end.lon, end.lat]);
    const trips = segmentTrips([...a, ...stop, ...b]);
    expect(trips).toHaveLength(2);
    expect(trips[0]!.length).toBeLessThanOrEqual(62);
    expect(trips[1]!.length).toBeLessThanOrEqual(62);
  });

  it('keeps short traffic-light stops within one trip', () => {
    const a = track(T0, 30, 10);
    const end = a[a.length - 1]!;
    const stop = stationary(end.ts + 5000, 1, [end.lon, end.lat]);
    const b = track(stop[stop.length - 1]!.ts + 5000, 30, 10, 5, [end.lon + 0.0001, end.lat]);
    expect(segmentTrips([...a, ...stop, ...b])).toHaveLength(1);
  });

  it('trims a trailing stop and drops tiny trips', () => {
    const a = track(T0, 40, 1.4);
    const end = a[a.length - 1]!;
    const stop = stationary(end.ts + 5000, 20, [end.lon, end.lat]);
    const trips = segmentTrips([...a, ...stop]);
    expect(trips).toHaveLength(1);
    // At most a couple of stop fixes survive (the anchor lags by < stationary radius)
    expect(trips[0]!.length).toBeLessThanOrEqual(43);
    expect(segmentTrips(track(T0, 5, 1))).toHaveLength(0);
  });
});

describe('inferMode', () => {
  it('detects walking and driving', () => {
    expect(inferMode(track(T0, 50, 1.4))).toBe('foot');
    expect(inferMode(track(T0, 50, 16))).toBe('car');
    expect(inferMode([])).toBe('foot');
  });
});
