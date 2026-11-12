import { type LaneDirection, laneAdvice } from '@wayfinder/shared/lanes';
import type { Instruction } from '@wayfinder/shared/schemas';
import { MANEUVER_PATH, MANEUVER_VIEWBOX, type ManeuverType } from '@wayfinder/shared/maneuvers';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { space } from '../lib/theme';

/** A lane's arrow in the turn shapes; a U-turn goes right, driving on the left. */
const SHAPE: Record<LaneDirection, ManeuverType> = {
  sharpLeft: 'sharpLeft',
  left: 'left',
  slightLeft: 'slightLeft',
  straight: 'straight',
  slightRight: 'slightRight',
  right: 'right',
  sharpRight: 'sharpRight',
  uTurn: 'uTurnRight',
};

/**
 * The lanes leading to the next turn, left to right as painted on the road: the ones to be in drawn
 * full, the others faint, with the advice in words for a screen reader.
 */
export function LaneGuide({ lanes, color, size = 28 }: { lanes: NonNullable<Instruction['lanes']>; color: string; size?: number }) {
  const advice = laneAdvice(lanes);
  if (!advice) return null;
  const box = `0 0 ${MANEUVER_VIEWBOX} ${MANEUVER_VIEWBOX}`;
  return (
    <View
      testID="lane-guide"
      accessible
      accessibilityLabel={advice}
      style={{ flexDirection: 'row', alignSelf: 'flex-start', borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.22)', paddingHorizontal: space[1] }}
    >
      {lanes.map((lane, i) => (
        <View
          key={i}
          testID={lane.valid ? 'lane-use' : 'lane-other'}
          style={{ paddingHorizontal: space[1], paddingVertical: 4, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: 'rgba(255,255,255,0.35)', opacity: lane.valid ? 1 : 0.35 }}
        >
          <Svg width={size} height={size} viewBox={box} accessible={false} importantForAccessibility="no-hide-descendants">
            {lane.directions.map((d) => (
              <Path key={d} d={MANEUVER_PATH[SHAPE[d]]} fill={color} />
            ))}
          </Svg>
        </View>
      ))}
    </View>
  );
}
