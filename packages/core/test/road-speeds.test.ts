import { describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
import { speedSamples } from '../src/services/road-speeds.js';

const start: LngLat = [153.0, -27.5];
/** A road east, a point every 100 m: 21 points, 2 km. */
const matched: LngLat[] = Array.from({ length: 21 }, (_, i) => destination(start, 90, i * 100));
/** Three roads: the first and last 500 m, and the kilometre between. */
const ways: Array<[number, number, number]> = [
  [0, 5, 1],
  [5, 15, 2],
  [15, 20, 3],
];
// Monday 2 November 2026, 8 am in Brisbane.
const t0 = Date.parse('2026-11-02T08:00:00+10:00');

/** Fixes every `everyS` seconds along the road at `mps`, a little to the side as GPS is. */
const drive = (mps: (m: number) => number, everyS = 2) => {
  const fixes: Array<{ lon: number; lat: number; ts: number }> = [];
  let m = 0;
  let ts = t0;
  while (m <= 2000) {
    const p = destination(destination(start, 90, m), 0, 4);
    fixes.push({ lon: p[0], lat: p[1], ts });
    m += mps(m) * everyS;
    ts += everyS * 1000;
  }
  return fixes;
};

describe('how fast trips went along each road', () => {
  it('times the roads between the first and the last, at the local hour', () => {
    const samples = speedSamples(matched, ways, drive(() => 10));
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ wayId: 2, dayKind: 0, hour: 8 });
    expect(samples[0]!.kmh).toBeCloseTo(36, 0);
    expect(samples[0]!.lengthM).toBeCloseTo(1000, -1);
  });

  it('counts the time stopped at lights along the road', () => {
    // A minute stopped half way along road 2, shown by fixes that stay put.
    let stopped = 0;
    const samples = speedSamples(matched, ways, drive((m) => (m >= 1000 && stopped++ < 30 ? 0.0001 : 10)));
    expect(samples[0]!.kmh).toBeCloseTo((1000 / 160) * 3.6, 0);
  });

  it('counts a long stop with no fixes, as the phone sends none standing still', () => {
    // Two minutes stopped half way along road 2: one fix as it stops, the next as it moves off.
    const fixes = drive(() => 10).filter((f) => f.ts <= t0 + 100_000);
    const stoppedAt = fixes.at(-1)!;
    const rest = drive(() => 10).filter((f) => f.ts > t0 + 100_000).map((f) => ({ ...f, ts: f.ts + 120_000 }));
    const samples = speedSamples(matched, ways, [...fixes, { ...stoppedAt, ts: stoppedAt.ts + 120_000 }, ...rest]);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.kmh).toBeCloseTo((1000 / 220) * 3.6, 0);
  });

  it('leaves out stretches it can’t time well', () => {
    // A gap of a minute in the fixes.
    const gappy = drive(() => 10).filter((f) => f.ts < t0 + 40_000 || f.ts > t0 + 100_000);
    expect(speedSamples(matched, ways, gappy)).toEqual([]);
    // Fixes nowhere near the matched road.
    expect(speedSamples(matched, ways, drive(() => 10).map((f) => ({ ...f, lat: f.lat + 0.01 })))).toEqual([]);
    // Impossibly fast.
    expect(speedSamples(matched, ways, drive(() => 60))).toEqual([]);
    // A short road between two others.
    expect(speedSamples(matched, [[0, 5, 1], [5, 6, 2], [6, 20, 3]], drive(() => 10))).toEqual([]);
    expect(speedSamples([start], ways, drive(() => 10))).toEqual([]);
    expect(speedSamples(matched, ways, [])).toEqual([]);
  });

  it('knows a weekend', () => {
    const saturday = drive(() => 10).map((f) => ({ ...f, ts: f.ts + 5 * 86_400_000 }));
    expect(speedSamples(matched, ways, saturday)[0]).toMatchObject({ dayKind: 1, hour: 8 });
  });
});
