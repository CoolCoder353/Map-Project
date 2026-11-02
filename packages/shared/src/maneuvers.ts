/**
 * What each turn is and how it's drawn, the same on the phone, the web and the car. The shapes are
 * the car's (Material symbols, apps/mobile/modules/wayfinder-car/.../res/drawable/wf_*.xml), so a
 * driver sees the same arrow in every place; roundabouts are drawn with the exit taken, as the
 * car's RoundaboutIcon does.
 */

export type ManeuverType =
  | 'straight'
  | 'slightLeft'
  | 'left'
  | 'sharpLeft'
  | 'slightRight'
  | 'right'
  | 'sharpRight'
  | 'keepLeft'
  | 'keepRight'
  | 'uTurnLeft'
  | 'uTurnRight'
  | 'roundabout'
  | 'roundaboutExit'
  | 'waypoint'
  | 'destination';

/** GraphHopper's instruction signs, as manoeuvres. */
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

export const maneuverTypeOf = (sign: number): ManeuverType => BY_SIGN[sign] ?? 'straight';

/** The size of the grid the paths are drawn on: an SVG viewBox of `0 0 960 960`. */
export const MANEUVER_VIEWBOX = 960;

const DESTINATION =
  'M360,240L440,240L440,160L360,160L360,240ZM520,240L520,160L600,160L600,240L520,240ZM360,560L360,480L440,480L440,560L360,560ZM680,400L680,320L760,320L760,400L680,400ZM680,560L680,480L760,480L760,560L680,560ZM520,560L520,480L600,480L600,560L520,560ZM680,240L680,160L760,160L760,240L680,240ZM440,320L440,240L520,240L520,320L440,320ZM200,800L200,160L280,160L280,240L360,240L360,320L280,320L280,400L360,400L360,480L280,480L280,800L200,800ZM600,480L600,400L680,400L680,480L600,480ZM440,480L440,400L520,400L520,480L440,480ZM360,400L360,320L440,320L440,400L360,400ZM520,400L520,320L600,320L600,400L520,400ZM600,320L600,240L680,240L680,320L600,320Z';
/** Queensland drives on the left, so roundabouts run clockwise: one clockwise glyph for entering and leaving. */
const ROUNDABOUT =
  'M280,840L280,597Q192,583 136,515.5Q80,448 80,360Q80,260 150,190Q220,120 320,120Q408,120 475.5,176Q543,232 557,320L727,320L664,256L720,200L880,360L720,520L663,464L727,400L556,400Q527,400 505,381Q483,362 478,333Q468,275 423.5,237.5Q379,200 320,200Q254,200 207,247Q160,294 160,360Q160,419 197.5,463.5Q235,508 293,518Q322,523 341,545Q360,567 360,596L360,840L280,840Z';

/** Each manoeuvre's shape, filled, on a 960 × 960 grid. */
export const MANEUVER_PATH: Record<ManeuverType, string> = {
  straight: 'M440,840L440,273L376,336L320,280L480,120L640,280L584,336L520,273L520,840L440,840Z',
  slightLeft: 'M520,800L520,496L320,296L320,386L240,386L240,160L466,160L466,240L376,240L577,441Q588,452 594,466.5Q600,481 600,497L600,800L520,800Z',
  left: 'M600,800L600,440L272,440L336,504L280,560L120,400L280,240L336,296L272,360L600,360Q633,360 656.5,383.5Q680,407 680,440L680,800L600,800Z',
  sharpLeft:
    'M640,840L640,600L320,600Q287,600 263.5,576.5Q240,553 240,520L240,272L176,336L120,280L280,120L440,280L384,336L320,272L320,520L640,520Q673,520 696.5,543.5Q720,567 720,600L720,840L640,840Z',
  slightRight: 'M360,800L360,497Q360,481 366,466.5Q372,452 383,441L584,240L494,240L494,160L720,160L720,386L640,386L640,296L440,496L440,800L360,800Z',
  right: 'M280,800L280,440Q280,407 303.5,383.5Q327,360 360,360L688,360L624,296L680,240L840,400L680,560L624,504L688,440L360,440L360,800L280,800Z',
  sharpRight:
    'M240,840L240,600Q240,567 263.5,543.5Q287,520 320,520L640,520L640,272L576,336L520,280L680,120L840,280L784,336L720,272L720,520Q720,553 696.5,576.5Q673,600 640,600L320,600L320,840L240,840Z',
  keepLeft:
    'M520,840L520,680Q502,616 456.5,585.5Q411,555 357,555Q346,555 335,556.5Q324,558 313,560L376,624L320,680L160,520L320,360L376,416L313,480Q322,478 332,477Q342,476 353,476Q397,476 441,489.5Q485,503 520,534L520,273L456,337L400,280L560,120L720,280L664,336L600,273L600,840L520,840Z',
  keepRight:
    'M360,840L360,273L296,336L240,280L400,120L560,280L504,337L440,273L440,534Q475,503 519,489.5Q563,476 607,476Q618,476 628,477Q638,478 647,480L584,416L640,360L800,520L640,680L584,624L647,560Q636,558 625,556.5Q614,555 603,555Q549,555 503.5,585.5Q458,616 440,680L440,840L360,840Z',
  uTurnLeft:
    'M640,840L640,360Q640,294 593,247Q546,200 480,200Q414,200 367,247Q320,294 320,360L320,528L384,464L440,520L280,680L120,520L176,464L240,528L240,360Q240,260 310,190Q380,120 480,120Q580,120 650,190Q720,260 720,360L720,840L640,840Z',
  uTurnRight:
    'M240,840L240,360Q240,260 310,190Q380,120 480,120Q580,120 650,190Q720,260 720,360L720,528L784,464L840,520L680,680L520,520L576,464L640,528L640,360Q640,294 593,247Q546,200 480,200Q414,200 367,247Q320,294 320,360L320,840L240,840Z',
  roundabout: ROUNDABOUT,
  roundaboutExit: ROUNDABOUT,
  waypoint: DESTINATION,
  destination: DESTINATION,
};

/**
 * A roundabout with the exit taken, on the same 960 grid, as lines to stroke (and an arrow head to
 * fill): in from the bottom, clockwise round to the exit `exitAngleDeg` round from the way in (90 a
 * left turn, 180 straight on, 270 right), and out along it. The rest of the ring is drawn faint.
 */
export interface RoundaboutDrawing {
  /** The way round to the exit, and the arms in and out: drawn solid. */
  taken: string;
  /** The rest of the ring: drawn faint. */
  rest: string;
  /** The arrow head on the way out, filled. */
  head: string;
  strokeWidth: number;
}

const C = 480;
const RING = 195;
const ARM = 435;
const at = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
};
const pt = ([x, y]: readonly [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;

/** An arc of the ring clockwise on screen (y down) from `fromDeg` through `sweepDeg`, split so a full turn still draws. */
function arc(fromDeg: number, sweepDeg: number): string {
  if (sweepDeg <= 0) return '';
  const half = sweepDeg / 2;
  const mid = at(fromDeg + half, RING);
  const end = at(fromDeg + sweepDeg, RING);
  return `M${pt(at(fromDeg, RING))}A${RING},${RING} 0 0 1 ${pt(mid)}A${RING},${RING} 0 0 1 ${pt(end)}`;
}

export function roundaboutDrawing(exitAngleDeg: number): RoundaboutDrawing {
  const angle = Math.min(360, Math.max(1, Math.round(exitAngleDeg)));
  // Measured from the way in at the bottom (90° with y down), round clockwise.
  const exit = 90 + angle;
  // The arrow head: its tip past the end of the arm, its back corners either side of the arm.
  const tip = at(exit, ARM + 45);
  const [bx, by] = at(exit, ARM - 105);
  const corner = (turn: number): [number, number] => {
    const a = ((exit + turn) * Math.PI) / 180;
    return [bx + Math.cos(a) * 105, by + Math.sin(a) * 105];
  };
  return {
    taken: `M${C},930L${pt(at(90, RING))}${arc(90, angle)}M${pt(at(exit, RING))}L${pt(at(exit, ARM))}`,
    rest: arc(exit, 360 - angle),
    head: `M${pt(tip)}L${pt(corner(90))}L${pt(corner(-90))}Z`,
    strokeWidth: 90,
  };
}
