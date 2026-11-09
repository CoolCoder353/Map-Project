import type { NavState } from '@wayfinder/nav';
import type { Instruction, Route } from '@wayfinder/shared/schemas';
import type { NavSnapshot } from '../nav/navigationService';
import { maneuverTypeOf } from '@wayfinder/shared/maneuvers';
import type { CarManeuver, CarNav } from './protocol';

/** A manoeuvre this close after the next one is shown with it ("then turn right"). */
export const THEN_WITHIN_M = 150;
/** Over the limit by this much, so GPS wobble at the limit isn't; the car's SpeedReadout agrees. */
export const OVER_LIMIT_BY_KMH = 3;

/** The manoeuvre after the next, when it comes close behind it. The phone shows it as the car does. */
export function thenAfter(route: Route, st: NavState | null): Instruction | null {
  const idx = st?.nextInstructionIndex;
  if (idx == null) return null;
  // An instruction's distance runs to the manoeuvre after it.
  const gap = route.instructions[idx]?.distanceM;
  const after = route.instructions[idx + 1];
  return after && gap != null && gap <= THEN_WITHIN_M ? after : null;
}

export const overLimit = (limitKmh: number | null, speedKmh: number | null) => limitKmh != null && speedKmh != null && speedKmh >= limitKmh + OVER_LIMIT_BY_KMH;

export function maneuverOf(ins: Pick<Instruction, 'sign' | 'exitNumber' | 'exitAngleDeg'>): CarManeuver {
  const type = maneuverTypeOf(ins.sign);
  const roundabout = type === 'roundabout';
  return { type, exit: roundabout && ins.exitNumber ? ins.exitNumber : null, exitAngleDeg: roundabout ? (ins.exitAngleDeg ?? null) : null };
}

/** What the car screen shows for a trip, or null when there isn't one. */
export function toCarNav(s: NavSnapshot, now: number): CarNav | null {
  // A walk is followed on the phone; the car's driving screen is for driving.
  if (!s.active || !s.route || s.route.mode !== 'car') return null;
  const st = s.state;
  const ins = st?.nextInstruction ?? st?.currentInstruction ?? null;
  const idx = st?.nextInstructionIndex ?? null;
  const then = thenAfter(s.route, st);
  const gap = idx != null ? s.route.instructions[idx]?.distanceM : undefined;
  const after = idx != null ? s.route.instructions[idx + 1] : undefined;
  const remainingS = st?.remainingDurationS ?? s.route.durationS;
  const hasLimit = st != null && st.status !== 'arrived';
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
    next: then ? { maneuver: maneuverOf(then), cue: then.text } : null,
    following:
      after && gap != null && st?.distanceToNextManeuverM != null
        ? { maneuver: maneuverOf(after), cue: after.text, road: after.streetName, distanceM: st.distanceToNextManeuverM + gap }
        : null,
    remainingDistanceM: st?.remainingDistanceM ?? s.route.distanceM,
    remainingDurationS: remainingS,
    arrivalEpochMs: Math.round(now + remainingS * 1000),
    position: s.position,
    headingDeg: s.headingDeg,
    // Off the route, or waiting for a new one, is when the road is least familiar: the limit stays.
    speedLimitKmh: hasLimit ? st.speedLimitKmh : null,
    speedLimitEstimated: hasLimit && st.speedLimitKmh !== null ? st.speedLimitEstimated : false,
    speedKmh: s.speedMps != null ? Math.round(s.speedMps * 3.6) : null,
    // Whether a light will be red is a guess from learned timings. On the driving display it would
    // read as the light's real state, and a driver might slow or speed up on it, so none are sent.
    lights: [],
  };
}
