import type { Instruction } from '@wayfinder/shared/schemas';
import type { NavSnapshot } from '../nav/navigationService';
import type { CarManeuver, CarNav, ManeuverType } from './protocol';

/** A manoeuvre this close after the next one is shown with it ("then turn right"). */
export const THEN_WITHIN_M = 150;

/** GraphHopper's instruction signs (see InstructionSchema). */
const BY_SIGN: Record<number, ManeuverType> = {
  [-98]: 'uTurnRight', // direction unknown; Queensland drives on the left, so U-turns go right
  [-8]: 'uTurnLeft',
  [-7]: 'keepLeft',
  [-6]: 'roundaboutExit',
  [-3]: 'sharpLeft',
  [-2]: 'left',
  [-1]: 'slightLeft',
  0: 'straight',
  1: 'slightRight',
  2: 'right',
  3: 'sharpRight',
  4: 'destination',
  5: 'waypoint',
  6: 'roundabout',
  7: 'keepRight',
  8: 'uTurnRight',
};

export function maneuverOf(ins: Pick<Instruction, 'sign' | 'exitNumber' | 'exitAngleDeg'>): CarManeuver {
  const type = BY_SIGN[ins.sign] ?? 'straight';
  const roundabout = type === 'roundabout';
  return { type, exit: roundabout && ins.exitNumber ? ins.exitNumber : null, exitAngleDeg: roundabout ? (ins.exitAngleDeg ?? null) : null };
}

/** What the car screen shows for a trip, or null when there isn't one. */
export function toCarNav(s: NavSnapshot, now: number): CarNav | null {
  if (!s.active || !s.route) return null;
  const st = s.state;
  const ins = st?.nextInstruction ?? st?.currentInstruction ?? null;
  const idx = st?.nextInstructionIndex ?? null;
  // An instruction's distance runs to the manoeuvre after it.
  const gap = idx != null ? s.route.instructions[idx]?.distanceM : undefined;
  const after = idx != null ? s.route.instructions[idx + 1] : undefined;
  const remainingS = st?.remainingDurationS ?? s.route.durationS;
  return {
    routeId: s.route.id,
    destinationName: s.destinationName,
    status: st?.status ?? 'starting',
    rerouting: s.rerouting,
    muted: s.muted,
    error: s.error,
    maneuver: ins ? maneuverOf(ins) : null,
    cue: ins?.text ?? '',
    road: ins?.streetName ?? '',
    distanceToManeuverM: st?.distanceToNextManeuverM ?? null,
    next: after && gap != null && gap <= THEN_WITHIN_M ? { maneuver: maneuverOf(after), cue: after.text } : null,
    remainingDistanceM: st?.remainingDistanceM ?? s.route.distanceM,
    remainingDurationS: remainingS,
    arrivalEpochMs: Math.round(now + remainingS * 1000),
    position: s.position,
    headingDeg: s.headingDeg,
    speedLimitKmh: st?.status === 'navigating' ? st.speedLimitKmh : null,
    speedKmh: s.speedMps != null ? Math.round(s.speedMps * 3.6) : null,
  };
}
