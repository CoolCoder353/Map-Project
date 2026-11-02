import { describe, expect, it } from 'vitest';
import { type LngLat, destination } from '../src/geo.js';
import {
  CYCLE_HORIZON_S,
  type LightTiming,
  directionAt,
  expectedDelayS,
  lightWaitText,
  lightsAhead,
  pointAlong,
  predictLight,
  remainingWaitS,
} from '../src/light-timing.js';
import { cumulativeM, signalsAlongRoute, travelTime } from '../src/road-facts.js';
import { utcOffsetS } from '../src/australia.js';

const start: LngLat = [153.0, -27.5];
const east = (m: number) => destination(start, 90, m);
const timing = (over: Partial<LightTiming> = {}): LightTiming => ({ stopChance: 0.7, waitS: 30, waits: [10, 20, 30, 45, 60], ...over });

describe('which way a drive goes through a set of lights', () => {
  const straight: LngLat[] = [start, east(100), east(200)];
  it('knows the heading it arrives on and the turn it makes', () => {
    expect(directionAt(straight, cumulativeM(straight), 100)).toBe('2straight');
    const left: LngLat[] = [start, east(100), destination(east(100), 0, 100)];
    expect(directionAt(left, cumulativeM(left), 100)).toBe('2left');
    const right: LngLat[] = [start, east(100), destination(east(100), 180, 100)];
    expect(directionAt(right, cumulativeM(right), 100)).toBe('2right');
    const back: LngLat[] = [start, east(100), east(20)];
    expect(directionAt(back, cumulativeM(back), 100)).toBe('2uturn');
  });
  it('goes straight on at the end of a line, and has nothing to say without one', () => {
    expect(directionAt(straight, cumulativeM(straight), 200)).toBe('2straight');
    expect(directionAt([start], [0], 0)).toBeNull();
    expect(directionAt(straight, cumulativeM(straight), 0)).toBeNull();
  });
  it('finds points along a line', () => {
    const cum = cumulativeM(straight);
    expect(pointAlong(straight, cum, -5)).toEqual(start);
    expect(pointAlong(straight, cum, 1e6)).toEqual(straight[2]);
    expect(pointAlong(straight, cum, 50)[0]).toBeCloseTo(east(50)[0], 6);
  });
});

describe('red or green when you get there', () => {
  it('goes by how often drives stopped there', () => {
    expect(predictLight(timing(), 0, 300)).toEqual({ state: 'red', waitS: 30 });
    expect(predictLight(timing({ stopChance: 0.3 }), 0, 300)).toEqual({ state: 'green', waitS: 0 });
  });

  it('uses a fixed cycle only for lights just ahead', () => {
    // Green from 06:00:00 local for 40 s of every 100 s; the phone is told Brisbane is UTC+10.
    const cycle = { cycleS: 100, greenS: 40, offsetS: 6 * 3600, utcOffsetS: 36_000 };
    const t = timing({ cycle, stopChance: 0.2 });
    const at = (localS: number) => (Date.UTC(2026, 10, 2) / 1000 - 36_000 + localS) * 1000;
    expect(predictLight(t, at(6 * 3600 + 210), 10)).toEqual({ state: 'green', waitS: 0 });
    expect(predictLight(t, at(6 * 3600 + 260), 10)).toEqual({ state: 'red', waitS: 40 });
    // Too far ahead to know to the second: back to how often drives stop.
    expect(predictLight(t, at(6 * 3600 + 260), CYCLE_HORIZON_S + 1).state).toBe('green');
  });

  it('allows the average stop for its share of drives', () => {
    expect(expectedDelayS(timing({ stopChance: 0.5 }))).toBeCloseTo(16.5);
    expect(expectedDelayS(timing({ waits: [], waitS: 20, stopChance: 1 }))).toBe(20);
  });
});

describe('waiting at the lights', () => {
  it('says roughly how much longer, from how long you have waited', () => {
    expect(remainingWaitS(timing(), 0)).toBe(30);
    expect(remainingWaitS(timing(), 18)).toBe(12);
    expect(remainingWaitS(timing(), 29)).toBeNull();
    expect(remainingWaitS(timing(), 70)).toBeNull();
    expect(lightWaitText(30)).toBe('Usually about 30 s more');
    expect(lightWaitText(22)).toBe('Usually about 20 s more');
    expect(lightWaitText(130)).toBe('Usually about 2 min more');
    expect(lightWaitText(5)).toBe('Usually changes soon');
    expect(lightWaitText(null)).toBe('Usually changes soon');
  });
});

describe('the lights ahead on a route', () => {
  const geometry: LngLat[] = Array.from({ length: 11 }, (_, i) => east(i * 400)); // 4 km, 300 s
  const route = {
    geometry,
    instructions: [{ interval: [0, 10] as [number, number], durationS: 300 }],
    trafficSignals: [
      { index: 2, timing: timing() },
      { index: 4 },
      { index: 6, timing: timing({ stopChance: 0.1 }) },
      { index: 9, timing: timing() },
    ],
  };
  const cum = cumulativeM(geometry);

  it('are the timed ones within reach, each red or green', () => {
    const ahead = lightsAhead(route, cum, 0, 0);
    expect(ahead.map((l) => [l.at, l.state])).toEqual([[geometry[2], 'red'], [geometry[6], 'green']]);
    expect(ahead[0]!.progressM).toBeCloseTo(800, -1);
  });

  it('drop the ones behind you, and reach as far as asked', () => {
    expect(lightsAhead(route, cum, 1200, 0).map((l) => l.at)).toEqual([geometry[6], geometry[9]]);
    expect(lightsAhead(route, cum, 0, 0, Infinity)).toHaveLength(3);
    expect(lightsAhead({ ...route, trafficSignals: undefined }, cum, 0, 0)).toEqual([]);
    expect(lightsAhead({ ...route, geometry: [start] }, [0], 0, 0)).toEqual([]);
  });

  it('times a fixed cycle by when the route gets you there', () => {
    // 30 s to the first lights; green for the first 40 s of each 100 from midnight UTC.
    const cycle = { cycleS: 100, greenS: 40, offsetS: 0, utcOffsetS: 0 };
    const fixed = { ...route, trafficSignals: [{ index: 1, timing: timing({ stopChance: 0.9, cycle }) }] };
    expect(lightsAhead(fixed, cum, 0, 20_000)[0]).toMatchObject({ state: 'red' }); // there at 50 s
    expect(lightsAhead(fixed, cum, 0, 80_000)[0]).toMatchObject({ state: 'green' }); // there at 110 s
  });
});

describe('lights and route times', () => {
  it('keep the id of the light each set is known by', () => {
    const line: LngLat[] = [start, east(500)];
    const p = east(250);
    expect(signalsAlongRoute(line, [{ id: '42', lon: p[0], lat: p[1], kind: 'signals' }])).toEqual([{ index: 1, kind: 'signals', id: '42' }]);
  });

  it('allow what drives going this way usually lose at a light', () => {
    const coords: LngLat[] = [start, east(500), east(1000)];
    const base = { coords, instructions: [{ interval: [0, 2] as [number, number], durationS: 100 }], timeRuns: null, wayRuns: [], learned: () => null };
    expect(travelTime({ ...base, signals: [{ index: 1, kind: 'signals' }] }).totalS).toBeCloseTo(115);
    expect(travelTime({ ...base, signals: [{ index: 1, kind: 'signals', timing: timing({ stopChance: 0.2 }) }] }).totalS).toBeCloseTo(106.6);
  });
});

describe('time zones', () => {
  it('knows a zone’s offset from UTC, with daylight saving', () => {
    expect(utcOffsetS(new Date('2026-11-02T00:00:00Z'), 'Australia/Brisbane')).toBe(36_000);
    expect(utcOffsetS(new Date('2026-11-02T00:00:00Z'), 'Australia/Sydney')).toBe(39_600);
    expect(utcOffsetS(new Date('2026-11-02T00:00:00Z'), 'Australia/Adelaide')).toBe(37_800);
  });
});
