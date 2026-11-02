import { MANEUVER_PATH, MANEUVER_VIEWBOX, maneuverTypeOf, roundaboutDrawing } from '@wayfinder/shared';

/**
 * A turn's arrow, the same shapes the phone and car show (keep, slight and sharp turns; roundabouts
 * clockwise, drawn with the exit taken where it's known). Decorative: the step's text says the turn.
 */
export function ManeuverIcon({ sign, exitAngleDeg }: { sign: number; exitAngleDeg?: number | null | undefined }) {
  const type = maneuverTypeOf(sign);
  const box = `0 0 ${MANEUVER_VIEWBOX} ${MANEUVER_VIEWBOX}`;
  if (type === 'roundabout' && exitAngleDeg) {
    const r = roundaboutDrawing(exitAngleDeg);
    return (
      <svg className="maneuver-icon" viewBox={box} aria-hidden="true" data-maneuver="roundabout-exit">
        <path d={r.rest} stroke="currentColor" strokeOpacity={0.35} strokeWidth={r.strokeWidth} strokeLinecap="round" fill="none" />
        <path d={r.taken} stroke="currentColor" strokeWidth={r.strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d={r.head} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="maneuver-icon" viewBox={box} aria-hidden="true" data-maneuver={type}>
      <path d={MANEUVER_PATH[type]} fill="currentColor" />
    </svg>
  );
}
