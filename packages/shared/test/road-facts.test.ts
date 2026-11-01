import { describe, expect, it } from 'vitest';
import { localDayHour, timeZoneAt } from '../src/australia.js';
import { type LngLat, destination } from '../src/geo.js';
import {
  AT_THE_LIGHTS,
  SIGNAL_DELAY_S,
  applyWayLimitRules,
  atNthLights,
  cumulativeM,
  markTurnsAtLights,
  signalsAlongRoute,
  splitEstimatedLimits,
  travelTime,
  usuallySlow,
  withoutCovered,
} from '../src/road-facts.js';

const start: LngLat = [153.0, -27.5];
/** A straight road east, a point every 100 m. */
const line = (points = 11): LngLat[] => Array.from({ length: points }, (_, i) => destination(start, 90, i * 100));
const north = (p: LngLat, m: number) => destination(p, 0, m);
const at = (p: LngLat, kind: 'signals' | 'crossing' | 'ramp_meter' = 'signals') => ({ lon: p[0], lat: p[1], kind });

describe('lights along a route', () => {
  it('finds lights on the road, in order, at their nearest point', () => {
    const road = line();
    const found = signalsAlongRoute(road, [at(destination(start, 90, 720)), at(north(destination(start, 90, 290), 8))]);
    expect(found).toEqual([
      { index: 3, kind: 'signals' },
      { index: 7, kind: 'signals' },
    ]);
  });

  it('leaves out lights off the road, and the ones beside a bridge or tunnel', () => {
    const road = line();
    expect(signalsAlongRoute(road, [at(north(destination(start, 90, 500), 40))])).toEqual([]);
    // Over a junction on a bridge: the lights are below, not on the route.
    expect(signalsAlongRoute(road, [at(destination(start, 90, 450))], (segment) => segment === 4)).toEqual([]);
    expect(signalsAlongRoute(road, [])).toEqual([]);
    expect(signalsAlongRoute([start], [at(start)])).toEqual([]);
  });

  it('counts a junction’s lights, one per approach, as one set of the most junction-like kind', () => {
    const road = line();
    const junction = destination(start, 90, 500);
    const found = signalsAlongRoute(road, [at(destination(junction, 270, 12), 'crossing'), at(junction), at(destination(junction, 90, 15), 'ramp_meter')]);
    expect(found).toEqual([{ index: 5, kind: 'signals' }]);
    // A crossing on its own a little further on is a set of its own.
    expect(signalsAlongRoute(road, [at(junction), at(destination(junction, 90, 200), 'crossing')])).toHaveLength(2);
  });
});

describe('turns at the lights', () => {
  const road = line();
  const ins = (sign: number, text: string, from: number, to: number): { sign: number; text: string; interval: [number, number]; atTrafficLights?: boolean } => ({ sign, text, interval: [from, to] });
  const route = [ins(0, 'Continue onto Main Street', 0, 5), ins(-2, 'Turn left onto Old Cleveland Road', 5, 8), ins(-7, 'Keep left', 8, 9), ins(2, 'Turn right onto Leicester Street', 9, 10), ins(4, 'Arrive at destination', 10, 10)];

  it('says a turn is at the lights where a set is just before it', () => {
    const out = markTurnsAtLights(route, road, [{ index: 5, kind: 'signals' }]);
    expect(out[1]).toMatchObject({ atTrafficLights: true, text: 'At the lights, turn left onto Old Cleveland Road' });
    expect(out[0]!.text).toBe('Continue onto Main Street');
    expect(out.filter((i) => i.atTrafficLights)).toHaveLength(1);
  });

  it('only for turns, not for lights well before a turn, nor ramp meters', () => {
    expect(markTurnsAtLights(route, road, [{ index: 8, kind: 'signals' }]).some((i) => i.atTrafficLights)).toBe(false); // a keep, not a turn
    expect(markTurnsAtLights(route, road, [{ index: 3, kind: 'signals' }]).some((i) => i.atTrafficLights)).toBe(false); // 200 m before
    expect(markTurnsAtLights(route, road, [{ index: 5, kind: 'ramp_meter' }]).some((i) => i.atTrafficLights)).toBe(false);
    expect(markTurnsAtLights(route, road, [])).toEqual(route);
  });

  it('names which set of lights when there are more to pass first', () => {
    const text = `${AT_THE_LIGHTS}, turn right onto Leicester Street`;
    expect(atNthLights(text, 0)).toBe(text);
    expect(atNthLights(text, 1)).toBe('At the second set of lights, turn right onto Leicester Street');
    expect(atNthLights(text, 2)).toBe('At the third set of lights, turn right onto Leicester Street');
    expect(atNthLights(text, 3)).toBe('At the fourth set of lights, turn right onto Leicester Street');
    // Too many to count usefully, or not a turn at the lights at all.
    expect(atNthLights(text, 4)).toBe(text);
    expect(atNthLights('Turn left', 2)).toBe('Turn left');
  });
});

describe('travel time', () => {
  const road = line();
  const instructions = [
    { interval: [0, 5] as [number, number], durationS: 50 },
    { interval: [5, 10] as [number, number], durationS: 50 },
    { interval: [10, 10] as [number, number], durationS: 0 },
  ];
  const ways: Array<[number, number, number]> = [
    [0, 5, 1],
    [5, 10, 2],
  ];
  const none = () => null;

  it('is the engine’s time where nothing more is known', () => {
    const t = travelTime({ coords: road, instructions, timeRuns: null, wayRuns: ways, learned: none, signals: [] });
    expect(t.totalS).toBeCloseTo(100);
    expect(t.instructionS.map((s) => Math.round(s))).toEqual([50, 50, 0]);
    expect(t.learnedExtraS).toBe(0);
    // The engine's own stretch times, where it sent them, give the same total shared differently.
    const runs = travelTime({ coords: road, instructions, timeRuns: [[0, 2, 40_000], [2, 10, 60_000]], wayRuns: ways, learned: none, signals: [] });
    expect(runs.totalS).toBeCloseTo(100);
    expect(runs.instructionS[0]).toBeCloseTo(40 + 22.5);
  });

  it('adds a wait at each set of lights, on the stretch arriving at it', () => {
    const t = travelTime({ coords: road, instructions, timeRuns: null, wayRuns: ways, learned: none, signals: [{ index: 3, kind: 'signals' }, { index: 7, kind: 'crossing' }] });
    expect(t.totalS).toBeCloseTo(100 + SIGNAL_DELAY_S.signals + SIGNAL_DELAY_S.crossing);
    expect(t.instructionS[0]).toBeCloseTo(50 + SIGNAL_DELAY_S.signals);
    expect(t.instructionS[1]).toBeCloseTo(50 + SIGNAL_DELAY_S.crossing);
  });

  it('takes the speed trips really go where it’s known, lights included', () => {
    // Way 2 (500 m) is driven at 18 km/h, 5 m/s: 100 s instead of 50.
    const t = travelTime({ coords: road, instructions, timeRuns: null, wayRuns: ways, learned: (id) => (id === 2 ? 18 : null), signals: [{ index: 7, kind: 'signals' }] });
    expect(t.instructionS[1]).toBeCloseTo(100, 0);
    expect(t.totalS).toBeCloseTo(150, 0);
    expect(t.learnedExtraS).toBeCloseTo(50, 0);
    expect(t.learnedEngineS).toBeCloseTo(50, 0);
    expect(usuallySlow(t, 100)).toBe(false); // under two minutes slower
    const slow = travelTime({ coords: road, instructions, timeRuns: null, wayRuns: ways, learned: () => 6, signals: [] });
    expect(usuallySlow(slow, 100)).toBe(true);
  });

  it('copes with a route of one point', () => {
    expect(travelTime({ coords: [start], instructions: [{ interval: [0, 0], durationS: 0 }], timeRuns: null, wayRuns: [], learned: none, signals: [{ index: 0, kind: 'signals' }] }).totalS).toBe(0);
  });

  it('measures along the line', () => {
    expect(cumulativeM(line(3)).map(Math.round)).toEqual([0, 100, 200]);
  });
});

describe('speed limits beyond the engine’s', () => {
  it('keeps signposted limits apart from the engine’s estimates', () => {
    const { signed, estimated } = splitEstimatedLimits(
      [
        [0, 4, 50],
        [4, 10, 60],
      ],
      [
        [0, 2, true],
        [2, 10, false],
      ],
    );
    expect(estimated).toEqual([[0, 2, 50]]);
    expect(signed).toEqual([
      [0, 2, null],
      [2, 4, 50],
      [4, 10, 60],
    ]);
    // No estimate flags (an older graph): every limit is signposted, as before.
    expect(splitEstimatedLimits([[0, 4, 50]], [])).toEqual({ signed: [[0, 4, 50]], estimated: [] });
    // Flags covering only part of a run leave the rest as it was.
    expect(splitEstimatedLimits([[0, 10, 50]], [[3, 6, true]]).signed).toEqual([
      [0, 3, 50],
      [3, 6, null],
      [6, 10, 50],
    ]);
  });

  it('applies school zones in force and drops limits on roads with electronic signs', () => {
    const limits: Array<[number, number, number | null]> = [[0, 10, 60]];
    const ways: Array<[number, number, number]> = [
      [0, 3, 1],
      [3, 6, 2],
      [6, 10, 3],
    ];
    const rules = (id: number) => (id === 2 ? { kmh: 40 } : id === 3 ? ('variable' as const) : null);
    expect(applyWayLimitRules(limits, ways, rules)).toEqual([
      [0, 3, 60],
      [3, 6, 40],
      [6, 10, null],
    ]);
    expect(applyWayLimitRules(limits, [], rules)).toEqual(limits);
    expect(applyWayLimitRules(limits, ways, () => null)).toEqual(limits);
  });

  it('drops estimates where a better limit already covers the road', () => {
    expect(withoutCovered([{ from: 0, to: 3, kmh: 50 }, { from: 5, to: 8, kmh: 50 }], [{ from: 2, to: 4, kmh: 40 }])).toEqual([{ from: 5, to: 8, kmh: 50 }]);
  });
});

describe('local time on Australian roads', () => {
  it('knows the time zone at a point', () => {
    expect(timeZoneAt([153.03, -27.47])).toBe('Australia/Brisbane'); // Brisbane
    expect(timeZoneAt([153.43, -28.0])).toBe('Australia/Brisbane'); // Gold Coast
    expect(timeZoneAt([153.54, -28.2])).toBe('Australia/Sydney'); // Tweed Heads
    expect(timeZoneAt([151.21, -33.87])).toBe('Australia/Sydney');
    expect(timeZoneAt([144.96, -37.81])).toBe('Australia/Sydney'); // Melbourne keeps the same clock
    expect(timeZoneAt([147.33, -42.88])).toBe('Australia/Hobart');
    expect(timeZoneAt([115.86, -31.95])).toBe('Australia/Perth');
    expect(timeZoneAt([130.84, -12.46])).toBe('Australia/Darwin');
    expect(timeZoneAt([138.6, -34.93])).toBe('Australia/Adelaide');
    expect(timeZoneAt([139.49, -20.73])).toBe('Australia/Brisbane'); // Mount Isa
    expect(timeZoneAt([134.0, -30.0])).toBe('Australia/Adelaide');
  });

  it('gives the weekday and hour on the local clock', () => {
    // 22:30 UTC on a Sunday is 8:30 on Monday in Brisbane.
    expect(localDayHour(new Date('2026-11-01T22:30:00Z'), 'Australia/Brisbane')).toEqual({ day: 1, hour: 8 });
    expect(localDayHour(new Date('2026-11-01T12:00:00Z'), 'Australia/Perth')).toEqual({ day: 0, hour: 20 });
  });
});
