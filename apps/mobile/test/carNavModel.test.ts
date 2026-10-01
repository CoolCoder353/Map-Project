import type { Instruction, Route } from '@wayfinder/shared/schemas';
import { describe, expect, it } from 'vitest';
import { CarNavSchema } from '../src/car/protocol';
import { maneuverOf, THEN_WITHIN_M, toCarNav } from '../src/car/navModel';
import type { NavSnapshot } from '../src/nav/navigationService';

const ins = (sign: number, text: string, distanceM: number, extra: Partial<Instruction> = {}): Instruction => ({ sign, text, streetName: '', distanceM, durationS: 10, interval: [0, 1], ...extra });
const route = (instructions: Instruction[]): Route => ({
  id: 'r1', kind: 'fastest', mode: 'car', distanceM: 5000, durationS: 600, extraDurationS: 0,
  geometry: [[153, -27.4], [153.1, -27.5]], instructions, viaPoints: [], novelty: { totalKm: 5, newKm: 1, noveltyPct: 20 },
});
const snap = (over: Partial<NavSnapshot>): NavSnapshot => ({ active: true, route: null, destinationName: 'Lookout', state: null, rerouting: false, error: null, muted: false, position: null, headingDeg: null, ...over });

describe('maneuverOf', () => {
  it.each([
    [-3, 'sharpLeft'], [-2, 'left'], [-1, 'slightLeft'], [0, 'straight'], [1, 'slightRight'], [2, 'right'], [3, 'sharpRight'],
    [4, 'destination'], [5, 'waypoint'], [-7, 'keepLeft'], [7, 'keepRight'], [-8, 'uTurnLeft'], [8, 'uTurnRight'], [-6, 'roundaboutExit'],
  ])('GraphHopper sign %i is %s', (sign, type) => expect(maneuverOf({ sign }).type).toBe(type));

  it('turns an unknown U-turn right, as Queensland drives on the left', () => expect(maneuverOf({ sign: -98 }).type).toBe('uTurnRight'));
  it('keeps the exit for a roundabout', () => expect(maneuverOf({ sign: 6, exitNumber: 2 })).toEqual({ type: 'roundabout', exit: 2 }));
  it('treats a sign it doesn’t know as straight on', () => expect(maneuverOf({ sign: 42 })).toEqual({ type: 'straight', exit: null }));
});

describe('toCarNav', () => {
  const instructions = [ins(0, 'Continue', 300), ins(-2, 'Turn left onto Main St', 100, { streetName: 'Main St' }), ins(2, 'Turn right', 800), ins(4, 'Arrive', 0)];
  const r = route(instructions);

  it('is nothing when no trip is running', () => expect(toCarNav(snap({ active: false }), 0)).toBeNull());

  it('is "starting" before the first fix, with the route’s own totals', () => {
    const n = toCarNav(snap({ route: r }), 1_000)!;
    expect(n).toMatchObject({ status: 'starting', maneuver: null, remainingDistanceM: 5000, remainingDurationS: 600, arrivalEpochMs: 601_000 });
    expect(CarNavSchema.safeParse(n).success).toBe(true);
  });

  it('shows the next manoeuvre, and the one after when it comes close behind', () => {
    const n = toCarNav(snap({
      route: r, position: [153, -27.4], headingDeg: 90,
      state: { status: 'navigating', snapped: null, distanceFromRouteM: 0, progressM: 0, remainingDistanceM: 4000, remainingDurationS: 500, currentInstruction: instructions[0]!, nextInstruction: instructions[1]!, nextInstructionIndex: 1, distanceToNextManeuverM: 250, speedLimitKmh: 60 },
    }), 0)!;
    expect(n).toMatchObject({ status: 'navigating', maneuver: { type: 'left', exit: null }, cue: 'Turn left onto Main St', road: 'Main St', distanceToManeuverM: 250, next: { maneuver: { type: 'right', exit: null }, cue: 'Turn right' } });
    expect(instructions[1]!.distanceM).toBeLessThanOrEqual(THEN_WITHIN_M);
    expect(CarNavSchema.safeParse(n).success).toBe(true);
  });

  it('leaves out a manoeuvre that is still far behind the next one', () => {
    const n = toCarNav(snap({
      route: r,
      state: { status: 'navigating', snapped: null, distanceFromRouteM: 0, progressM: 0, remainingDistanceM: 900, remainingDurationS: 90, currentInstruction: instructions[1]!, nextInstruction: instructions[2]!, nextInstructionIndex: 2, distanceToNextManeuverM: 50, speedLimitKmh: null },
    }), 0)!;
    expect(n.next).toBeNull();
  });
});
