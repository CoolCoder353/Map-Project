import { describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
import { conditionalLimitNow, finishRoute, NO_ROAD_FACTS, type RoadFacts } from '../src/services/road-facts.js';
import { toRoute } from '../src/services/routing.js';
import { straightPath } from './helpers/fakes.js';

const SCHOOL = '40 @ (Mo-Fr 07:00-09:00,14:00-16:00; PH off; SH off)';
// Tuesday 3 November 2026, Brisbane time (UTC+10).
const brisbane = (hhmm: string, day = '03') => new Date(`2026-11-${day}T${hhmm}:00+10:00`);

describe('school zones and other conditional limits', () => {
  it('holds in the morning and afternoon on weekdays only', () => {
    expect(conditionalLimitNow(SCHOOL, 'Australia/Brisbane', brisbane('08:15'))).toBe(40);
    expect(conditionalLimitNow(SCHOOL, 'Australia/Brisbane', brisbane('15:30'))).toBe(40);
    expect(conditionalLimitNow(SCHOOL, 'Australia/Brisbane', brisbane('12:00'))).toBeNull();
    expect(conditionalLimitNow(SCHOOL, 'Australia/Brisbane', brisbane('08:15', '07'))).toBeNull(); // Saturday
  });

  it('goes by the road’s own clock', () => {
    // 8:15 in Brisbane is 9:15 in Sydney during daylight saving: the zone there has ended.
    expect(conditionalLimitNow('40 @ (Mo-Fr 08:00-09:00)', 'Australia/Sydney', brisbane('08:15'))).toBeNull();
    expect(conditionalLimitNow('40 @ (Mo-Fr 08:00-09:00)', 'Australia/Brisbane', brisbane('08:15'))).toBe(40);
  });

  it('reads several conditions, tagged without spaces or brackets', () => {
    const tag = '40 @ (Mo-Fr 08:00-09:30,14:30-16:00;PH off;SH off); 60 @ Sa-Su';
    expect(conditionalLimitNow(tag, 'Australia/Brisbane', brisbane('09:00'))).toBe(40);
    expect(conditionalLimitNow(tag, 'Australia/Brisbane', brisbane('09:00', '08'))).toBe(60);
  });

  it('ignores what it can’t read', () => {
    expect(conditionalLimitNow('40 @ wet', 'Australia/Brisbane', brisbane('08:15'))).toBeNull();
    expect(conditionalLimitNow('none @ (Mo-Fr 07:00-09:00)', 'Australia/Brisbane', brisbane('08:15'))).toBeNull();
    expect(conditionalLimitNow('300 @ (Mo-Fr 07:00-09:00)', 'Australia/Brisbane', brisbane('08:15'))).toBeNull();
    expect(conditionalLimitNow('40 @ (SH off)', 'Australia/Brisbane', brisbane('08:15'))).toBeNull();
  });
});

describe('finishing a route with what the map knows about its roads', () => {
  const from: LngLat = [153.0, -27.5];
  const to = destination(from, 90, 1000);
  const base = () => {
    const path = straightPath([from, to], 12.5); // 80 s
    const last = path.points.coordinates.length - 1;
    path.details = {
      osm_way_id: [[0, 4, 11], [4, 7, 22], [7, last, 33]],
      max_speed: [[0, 2, 50], [2, last, 60]],
      max_speed_estimated: [[0, 2, true], [2, last, false]],
    };
    return path;
  };
  const route = (path = base(), mode: 'car' | 'foot' = 'car') =>
    toRoute(path, { kind: 'fastest', mode, novelty: { totalKm: 1, newKm: 1, noveltyPct: 100 } as never, extraDurationS: 0, viaPoints: [] });
  const facts = (over: Partial<RoadFacts> = {}): RoadFacts => ({ ...NO_ROAD_FACTS, ...over });

  it('shows estimated limits apart from signposted ones', () => {
    const path = base();
    const done = finishRoute(route(path), path, NO_ROAD_FACTS, brisbane('12:00'));
    expect(done.speedLimits).toEqual([{ from: 2, to: 10, kmh: 60 }]);
    expect(done.estimatedSpeedLimits).toEqual([{ from: 0, to: 2, kmh: 50 }]);
    expect(done.durationS).toBeCloseTo(80);
    expect(done.trafficSignals).toBeUndefined();
    expect(done.usuallySlow).toBeUndefined();
  });

  it('lowers the limit in a school zone while it’s in force, and drops it on electronic signs', () => {
    const path = base();
    const rules = new Map([
      [22, { conditional: SCHOOL, variable: false, state: 'QLD' }],
      [33, { conditional: null, variable: true, state: null }],
    ]);
    expect(finishRoute(route(path), path, facts({ rules }), brisbane('08:15')).speedLimits).toEqual([{ from: 2, to: 4, kmh: 60 }, { from: 4, to: 7, kmh: 40 }]);
    expect(finishRoute(route(path), path, facts({ rules }), brisbane('12:00')).speedLimits).toEqual([{ from: 2, to: 7, kmh: 60 }]);
    // Without a state the road goes by the time where the route starts.
    const stateless = new Map([[22, { conditional: SCHOOL, variable: false, state: null }]]);
    expect(finishRoute(route(path), path, facts({ rules: stateless }), brisbane('08:15')).speedLimits).toContainEqual({ from: 4, to: 7, kmh: 40 });
  });

  it('marks the lights, says turns at them, and allows for the wait', () => {
    const path = base();
    path.instructions = [
      { distance: 500, sign: 0, interval: [0, 5], text: 'Continue onto Main Street', time: 40_000, street_name: 'Main Street' },
      { distance: 500, sign: -2, interval: [5, 10], text: 'Turn left onto Old Cleveland Road', time: 40_000, street_name: 'Old Cleveland Road' },
      { distance: 0, sign: 4, interval: [10, 10], text: 'Arrive at destination', time: 0 },
    ];
    const lights = { signals: [{ lon: path.points.coordinates[5]![0], lat: path.points.coordinates[5]![1], kind: 'signals' as const }] };
    const done = finishRoute(route(path), path, facts(lights), brisbane('12:00'));
    expect(done.trafficSignals).toEqual([{ index: 5, kind: 'signals' }]);
    expect(done.instructions[1]).toMatchObject({ atTrafficLights: true, text: 'At the lights, turn left onto Old Cleveland Road' });
    expect(done.durationS).toBeCloseTo(95);
    // Over a junction on a bridge there are no lights to stop at.
    path.details!.road_environment = [[0, 4, 'road'], [4, 6, 'bridge'], [6, 10, 'road']];
    expect(finishRoute(route(path), path, facts(lights), brisbane('12:00')).trafficSignals).toBeUndefined();
    // On foot, lights aren't counted.
    expect(finishRoute(route(path, 'foot'), path, facts(lights), brisbane('12:00')).trafficSignals).toBeUndefined();
  });

  it('takes the time trips really take, and says when that’s usually slow', () => {
    const path = straightPath([from, destination(from, 90, 5000)], 12.5); // 400 s
    const last = path.points.coordinates.length - 1;
    path.details = { osm_way_id: [[0, last, 44]], time: [[0, last, 400_000]] };
    const done = finishRoute(route(path), path, facts({ speeds: new Map([[44, 20]]) }), brisbane('17:00'));
    expect(done.durationS).toBeCloseTo(900, 0);
    expect(done.instructions[0]!.durationS).toBeCloseTo(900, 0);
    expect(done.usuallySlow).toBe(true);
  });
});
