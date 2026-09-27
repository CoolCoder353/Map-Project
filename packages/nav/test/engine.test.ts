import { describe, expect, it } from 'vitest';
import { type LngLat, type Route, destination, lineLengthM } from '@wayfinder/shared';
import { NavigationSession, type NavEvent, simulateFixes } from '../src/engine.js';

const start: LngLat = [149.1, -35.3];
const corner = destination(start, 90, 1000);
const end = destination(corner, 0, 1000);

function lRoute(mode: 'car' | 'foot' = 'car', speed = 14): Route {
  const geometry: LngLat[] = [start, corner, end];
  const d = lineLengthM(geometry);
  return {
    id: 'r1',
    kind: 'fastest',
    mode,
    distanceM: d,
    durationS: d / speed,
    extraDurationS: 0,
    geometry,
    viaPoints: [],
    novelty: { totalKm: d / 1000, newKm: 0, noveltyPct: 0 },
    instructions: [
      { sign: 0, text: 'Continue onto Alpha Street', streetName: 'Alpha Street', distanceM: 1000, durationS: 1000 / speed, interval: [0, 1] },
      { sign: -2, text: 'Turn left onto Beta Road', streetName: 'Beta Road', distanceM: 1000, durationS: 1000 / speed, interval: [1, 2] },
      { sign: 4, text: 'Arrive at destination', streetName: '', distanceM: 0, durationS: 0, interval: [2, 2] },
    ],
  };
}

function run(session: NavigationSession, fixes: ReturnType<typeof simulateFixes>) {
  const events: NavEvent[] = [];
  const states = fixes.map((f) => {
    const r = session.update(f);
    events.push(...r.events);
    return r.state;
  });
  return { events, states };
}

describe('NavigationSession', () => {
  it('announces manoeuvres at each threshold in order and arrives once', () => {
    const route = lRoute();
    const s = new NavigationSession(route);
    const { events, states } = run(s, simulateFixes(route.geometry, { speedMps: 14, intervalS: 1 }));
    const announces = events.filter((e) => e.type === 'announce');
    const turn = announces.filter((e) => e.instructionIndex === 1).map((e) => e.thresholdM);
    expect(turn).toEqual([800, 200, 40]);
    expect(announces.find((e) => e.instructionIndex === 1 && e.thresholdM === 200)!.text).toMatch(
      /^In 200 metres, turn left onto Beta Road$/,
    );
    expect(announces.find((e) => e.instructionIndex === 1 && e.thresholdM === 40)!.text).toBe('Turn left onto Beta Road');
    expect(events.filter((e) => e.type === 'arrived')).toHaveLength(1);
    expect(events.some((e) => e.type === 'offRoute')).toBe(false);
    expect(states.at(-1)!.status).toBe('arrived');
    // remaining distance is monotonically non-increasing (within snapping noise)
    for (let i = 1; i < states.length; i++) {
      expect(states[i]!.remainingDistanceM).toBeLessThanOrEqual(states[i - 1]!.remainingDistanceM + 1);
    }
    const mid = states[Math.floor(states.length / 2)]!;
    expect(mid.remainingDurationS).toBeGreaterThan(50);
    expect(mid.remainingDurationS).toBeLessThan(100);
  });

  it('tolerates GPS noise without going off route', () => {
    const route = lRoute();
    const s = new NavigationSession(route);
    const { events } = run(s, simulateFixes(route.geometry, { speedMps: 14, intervalS: 1, lateralOffsetM: 15 }));
    expect(events.some((e) => e.type === 'offRoute')).toBe(false);
  });

  it('requests a reroute after consecutive off-route fixes (missed turn)', () => {
    const route = lRoute();
    const s = new NavigationSession(route);
    const overshoot = destination(corner, 90, 400);
    const { events, states } = run(s, simulateFixes([start, overshoot], { speedMps: 14, intervalS: 1 }));
    const off = events.filter((e) => e.type === 'offRoute');
    expect(off).toHaveLength(1);
    const ev = off[0] as Extract<NavEvent, { type: 'offRoute' }>;
    expect(ev.to).toEqual(end);
    expect(states.at(-1)!.status).toBe('offRoute');

    // After the app fetches a new route from the current position, navigation resumes.
    const here: LngLat = [ev.from[0], ev.from[1]];
    const reroute = { ...lRoute(), id: 'r2', geometry: [here, corner, end] as LngLat[] };
    s.replaceRoute(reroute);
    expect(s.snapshot.status).toBe('navigating');
    const after = run(s, simulateFixes(reroute.geometry, { speedMps: 14, intervalS: 1 }));
    expect(after.events.filter((e) => e.type === 'arrived')).toHaveLength(1);
  });

  it('walking uses tighter thresholds', () => {
    const route = lRoute('foot', 1.4);
    const s = new NavigationSession(route);
    const { events } = run(s, simulateFixes(route.geometry, { speedMps: 1.4, intervalS: 2 }));
    const turn = events.filter((e) => e.type === 'announce' && e.instructionIndex === 1).map((e) => (e as { thresholdM: number }).thresholdM);
    expect(turn).toEqual([50, 12]);
  });

  it('handles an out-and-back route: no early arrival, no jumping to the return leg', () => {
    const far = destination(start, 90, 1500);
    const geometry: LngLat[] = [start, far, start];
    const d = lineLengthM(geometry);
    const route: Route = {
      ...lRoute('foot', 1.4),
      kind: 'roundtrip',
      geometry,
      distanceM: d,
      durationS: d / 1.4,
      viaPoints: [far],
      instructions: [
        { sign: 0, text: 'Head east', streetName: '', distanceM: 1500, durationS: 1500 / 1.4, interval: [0, 1] },
        { sign: 5, text: 'Waypoint 1', streetName: '', distanceM: 0, durationS: 0, interval: [1, 1] },
        { sign: 8, text: 'Make a U-turn', streetName: '', distanceM: 1500, durationS: 1500 / 1.4, interval: [1, 2] },
        { sign: 4, text: 'Arrive at destination', streetName: '', distanceM: 0, durationS: 0, interval: [2, 2] },
      ],
    };
    const s = new NavigationSession(route);
    const { events, states } = run(s, simulateFixes(geometry, { speedMps: 1.4, intervalS: 5 }));
    // The first fix is at the start (which is also the end) but must not count as arrival.
    expect(states[0]!.status).toBe('navigating');
    expect(states[0]!.progressM).toBeLessThan(50);
    const idxVia = events.findIndex((e) => e.type === 'viaReached');
    const idxArrive = events.findIndex((e) => e.type === 'arrived');
    expect(idxVia).toBeGreaterThanOrEqual(0);
    expect(idxArrive).toBeGreaterThan(idxVia);
    // progress keeps increasing past the halfway point on the way back
    const back = states.slice(Math.floor(states.length * 0.75));
    expect(back[0]!.progressM).toBeGreaterThan(1500);
  });
});

describe('speed limit', () => {
  it('tells you the limit of the road you are on, and nothing where it is not known', () => {
    const route = { ...lRoute(), geometry: [start, destination(start, 90, 500), corner, end], speedLimits: [{ from: 0, to: 1, kmh: 60 }, { from: 2, to: 3, kmh: 80 }] };
    route.instructions = [
      { ...route.instructions[0]!, interval: [0, 2] },
      { ...route.instructions[1]!, interval: [2, 3] },
      { ...route.instructions[2]!, interval: [3, 3] },
    ];
    const s = new NavigationSession(route);
    expect(s.snapshot.speedLimitKmh).toBeNull();
    const at = (p: LngLat) => s.update({ ts: 0, lon: p[0], lat: p[1], accuracyM: 5 }).state.speedLimitKmh;
    expect(at(destination(start, 90, 200))).toBe(60);
    expect(at(destination(start, 90, 700))).toBeNull();
    expect(at(destination(corner, 0, 300))).toBe(80);
  });

  it('shows none for a route from a server that does not send limits', () => {
    const s = new NavigationSession(lRoute());
    expect(s.update({ ts: 0, lon: start[0] + 0.001, lat: start[1], accuracyM: 5 }).state.speedLimitKmh).toBeNull();
  });
});
