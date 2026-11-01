import { describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
import { type ModelPass, backTest, buildTimings, fitCycle, lightPasses } from '../src/services/light-timing.js';

const start: LngLat = [153.0, -27.5];
const east = (m: number) => destination(start, 90, m);
/** A road east, a point every 100 m: 2 km, with lights at 1 km. */
const matched: LngLat[] = Array.from({ length: 21 }, (_, i) => east(i * 100));
const light = east(1000);
const signals = [{ id: '7', lon: light[0], lat: light[1], kind: 'signals' as const }];
// Monday 2 November 2026, 8 am in Brisbane.
const t0 = Date.parse('2026-11-02T08:00:00+10:00');
const local8am = 8 * 3600;

/** Fixes every `everyS` along the road at 10 m/s, stopping `stopS` seconds at `stopAtM`. */
function drive({ stopAtM = 990, stopS = 0, everyS = 1 } = {}) {
  const fixes: Array<{ lon: number; lat: number; ts: number }> = [];
  let m = 0;
  let ts = t0;
  let held = 0;
  while (m <= 2000) {
    const p = destination(east(m), 0, 3);
    fixes.push({ lon: p[0], lat: p[1], ts });
    if (m >= stopAtM && held < stopS) held += everyS;
    else m += 10 * everyS;
    ts += everyS * 1000;
  }
  return fixes;
}

describe('timing a drive through the lights', () => {
  it('goes through on green', () => {
    const [pass] = lightPasses(matched, drive(), signals);
    expect(pass).toMatchObject({ signalId: '7', direction: '2straight', dayKind: 0, hour: 8, stopped: false, waitS: 0, greenS: null });
    expect(pass!.arriveS).toBeCloseTo(local8am + 100, 0);
    expect(pass!.localDay).toBe(Math.floor((t0 / 1000 + 36_000) / 86_400));
  });

  it('waits at the front, and says when they turned green', () => {
    const [pass] = lightPasses(matched, drive({ stopS: 30 }), signals);
    expect(pass!.stopped).toBe(true);
    expect(pass!.waitS).toBeCloseTo(30, -1);
    // Stopped 10 m short after 99 s, last still 30 s later; first in the queue, so green 1.5 s before moving.
    expect(pass!.arriveS).toBeCloseTo(local8am + 99, 0);
    expect(pass!.greenS).toBeCloseTo(local8am + 129 - 1.5, 0);
  });

  it('waits back in the queue, too deep to say when they turned green', () => {
    const [pass] = lightPasses(matched, drive({ stopAtM: 920, stopS: 20 }), signals);
    expect(pass).toMatchObject({ stopped: true, greenS: null });
  });

  it('allows a few cars ahead when timing the green', () => {
    const [pass] = lightPasses(matched, drive({ stopAtM: 970, stopS: 20 }), signals);
    // 30 m back: three cars ahead, 1.5 s each, as well as the 1.5 s to get going.
    expect(pass!.greenS).toBeCloseTo(local8am + 117 - 6, 0);
  });

  it('can’t time lights from sparse fixes, at the start of a trip, or without an id', () => {
    expect(lightPasses(matched, drive({ everyS: 15 }), signals)).toEqual([]);
    const near = east(100);
    expect(lightPasses(matched, drive(), [{ id: '8', lon: near[0], lat: near[1], kind: 'signals' }])).toEqual([]);
    expect(lightPasses(matched, drive(), [{ lon: light[0], lat: light[1], kind: 'signals' }])).toEqual([]);
    expect(lightPasses(matched, [], signals)).toEqual([]);
    expect(lightPasses(matched, drive(), [])).toEqual([]);
    // Fixes nowhere near the road.
    expect(lightPasses(matched, drive().map((f) => ({ ...f, lat: f.lat + 0.01 })), signals)).toEqual([]);
  });
});

const pass = (over: Partial<ModelPass> = {}): ModelPass => ({
  signalId: '7', direction: '2straight', dayKind: 0, hour: 8, userId: 'a', stopped: false, waitS: 0, localDay: 20_000, arriveS: local8am, greenS: null, ...over,
});

describe('typical timings', () => {
  it('need enough passes from enough people', () => {
    const one = Array.from({ length: 6 }, () => pass({ stopped: true, waitS: 20 }));
    expect(buildTimings(one)).toEqual([]);
    const two = [...one.slice(0, 4), pass({ userId: 'b' })];
    const rows = buildTimings(two);
    expect(rows.map((r) => [r.direction, r.hour])).toEqual([['2straight', 8], ['2straight', 24], ['*', 24]]);
  });

  it('count each person once, however often they go through', () => {
    // Four stops from one person, one green pass from another: an even split.
    const rows = buildTimings([...Array.from({ length: 4 }, () => pass({ stopped: true, waitS: 20 })), pass({ userId: 'b' })]);
    const r = rows.find((x) => x.hour === 8)!;
    expect(r.stopChance).toBeCloseTo(0.5);
    expect(r.waits).toEqual([20, 20, 20, 20, 20]);
    expect(r.waitS).toBe(20);
    expect(r.passes).toBe(5);
    expect(r.cycle).toBeNull();
  });

  it('have no waits where nobody stopped', () => {
    const r = buildTimings([pass(), pass(), pass(), pass({ userId: 'b' }), pass({ userId: 'b' })])[0]!;
    expect(r).toMatchObject({ stopChance: 0, waits: [], waitS: 0 });
  });
});

/** Six mornings at lights on a fixed 90 s cycle, green for 35 s from 17 s past each 90 from midnight. */
function fixedMornings(): ModelPass[] {
  const CYCLE = 90;
  const OFFSET = 17;
  const out: ModelPass[] = [];
  let k = 0;
  for (let day = 0; day < 6; day++) {
    for (let i = 0; i < 6; i++) {
      // Cycles spread over the hour, odd and even both.
      const n = 321 + ((day * 7 + i * 5) % 39);
      const onset = n * CYCLE + OFFSET;
      const userId = k++ % 2 ? 'a' : 'b';
      const localDay = 20_000 + day;
      if (i % 2) out.push(pass({ userId, localDay, stopped: false, arriveS: onset + 3 + ((day * 5 + i * 4) % 28) }));
      else out.push(pass({ userId, localDay, stopped: true, waitS: 30, arriveS: onset - 30, greenS: onset + ((day + i) % 3) - 1 }));
    }
  }
  return out;
}

describe('fixed cycles', () => {
  it('are found where the changes to green line up from day to day', () => {
    const c = fitCycle(fixedMornings())!;
    expect(c.cycleS).toBeCloseTo(90, 0);
    expect(c.offsetS).toBeCloseTo(17, -0.5);
    expect(c.greenS).toBeGreaterThan(25);
    expect(c.greenS).toBeLessThan(60);
    // And kept with the hour's timing.
    expect(buildTimings(fixedMornings()).find((r) => r.hour === 8)!.cycle).not.toBeNull();
  });

  it('aren’t found where they don’t, or from too few days', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const adaptive = fixedMornings().map((p) => (p.greenS === null ? p : { ...p, greenS: local8am + rand() * 3600 }));
    expect(fitCycle(adaptive)).toBeNull();
    expect(fitCycle(fixedMornings().filter((p) => p.localDay < 20_003))).toBeNull();
  });

  it('aren’t used where they predict no better than how often drives stop', () => {
    // Every drive stopped: "always red" is already right, so a cycle adds nothing.
    expect(fitCycle(fixedMornings().map((p) => ({ ...p, stopped: true, greenS: p.greenS ?? p.arriveS - 5 })))).toBeNull();
  });
});

describe('checking older passes against the newest', () => {
  it('counts how many it got right', () => {
    const old = [pass({ stopped: true, waitS: 20 }), pass({ stopped: true, waitS: 25 }), pass({ stopped: true, waitS: 20 }), pass({ userId: 'b', stopped: true, waitS: 30 }), pass({ userId: 'b' })];
    expect(backTest(old, [pass({ stopped: true }), pass(), pass({ signalId: '99' })])).toEqual({ checked: 2, correct: 1 });
    expect(backTest([], [pass()])).toEqual({ checked: 0, correct: 0 });
  });
});
