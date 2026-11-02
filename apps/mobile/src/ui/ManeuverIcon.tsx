import { MANEUVER_PATH, MANEUVER_VIEWBOX, maneuverTypeOf, roundaboutDrawing } from '@wayfinder/shared/maneuvers';
import Svg, { Path } from 'react-native-svg';

/**
 * A turn's arrow, the same shapes the car shows (keep, slight and sharp turns; roundabouts
 * clockwise, drawn with the exit taken where it's known). Decorative: the words beside it say the turn.
 */
export function ManeuverIcon({ sign, exitAngleDeg, size, color }: { sign: number; exitAngleDeg?: number | null | undefined; size: number; color: string }) {
  const type = maneuverTypeOf(sign);
  const box = `0 0 ${MANEUVER_VIEWBOX} ${MANEUVER_VIEWBOX}`;
  if (type === 'roundabout' && exitAngleDeg) {
    const r = roundaboutDrawing(exitAngleDeg);
    return (
      <Svg testID="maneuver-roundabout" width={size} height={size} viewBox={box} accessible={false} importantForAccessibility="no-hide-descendants">
        <Path d={r.rest} stroke={color} strokeOpacity={0.35} strokeWidth={r.strokeWidth} strokeLinecap="round" fill="none" />
        <Path d={r.taken} stroke={color} strokeWidth={r.strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={r.head} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg testID={`maneuver-${type}`} width={size} height={size} viewBox={box} accessible={false} importantForAccessibility="no-hide-descendants">
      <Path d={MANEUVER_PATH[type]} fill={color} />
    </Svg>
  );
}
