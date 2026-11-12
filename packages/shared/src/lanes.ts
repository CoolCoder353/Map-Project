/**
 * Which lanes to be in for a turn, from the lane markings mapped in OpenStreetMap (`turn:lanes`,
 * e.g. "left|through|through;right"). Pure functions over route geometry: the server attaches the
 * lanes to each turn of a route, and the phone draws them under the turn.
 */
import { type LngLat, haversineM, projectOntoSegment } from './geo.js';

/** What a lane's arrows point to, in the same words as the turn shapes. */
export type LaneDirection = 'sharpLeft' | 'left' | 'slightLeft' | 'straight' | 'slightRight' | 'right' | 'sharpRight' | 'uTurn';

export interface Lane {
  directions: LaneDirection[];
  /** This lane can be used for the turn. */
  valid: boolean;
}

/** A way's mapped lanes, each direction as tagged, and its line. */
export interface WayLanes {
  forward: string | null;
  backward: string | null;
  coords: LngLat[];
}

const OSM_DIRECTION: Record<string, LaneDirection> = {
  sharp_left: 'sharpLeft',
  left: 'left',
  slight_left: 'slightLeft',
  through: 'straight',
  slight_right: 'slightRight',
  right: 'right',
  sharp_right: 'sharpRight',
  reverse: 'uTurn',
  // A lane that merges, or has no arrows painted, goes on ahead.
  merge_to_left: 'straight',
  merge_to_right: 'straight',
  none: 'straight',
  '': 'straight',
};

/** More lanes than this is a mapping mistake, not a road. */
export const MAX_LANES = 12;

/** The lanes in a `turn:lanes` value, left to right, or null where it can't be read. */
export function parseTurnLanes(tag: string | null | undefined): LaneDirection[][] | null {
  if (tag == null) return null;
  const lanes = tag.split('|');
  if (lanes.length < 2 || lanes.length > MAX_LANES) return null;
  const out: LaneDirection[][] = [];
  for (const lane of lanes) {
    const dirs = new Set<LaneDirection>();
    for (const raw of lane.split(';')) {
      const d = OSM_DIRECTION[raw.trim()];
      if (!d) return null;
      dirs.add(d);
    }
    out.push([...dirs]);
  }
  return out;
}

/**
 * The lanes that suit a turn, most fitting first: a left turn wants a left-turn lane, and failing
 * that a sharp or slight left one. GraphHopper's turn signs: -3..3 sharp left to sharp right, ±7
 * keep left or right, 6 a roundabout (by how far round the exit is, Queensland's roundabouts
 * running clockwise), ±8 and -98 a U-turn (from the right, driving on the left). Null for a sign
 * that isn't a turn at a junction.
 */
export function lanePreferences(sign: number, exitAngleDeg?: number): LaneDirection[][] | null {
  switch (sign) {
    case -3:
      return [['sharpLeft'], ['left']];
    case -2:
      return [['left'], ['sharpLeft', 'slightLeft']];
    case -1:
      return [['slightLeft'], ['left']];
    case 0:
      return [['straight'], ['slightLeft', 'slightRight']];
    case 1:
      return [['slightRight'], ['right']];
    case 2:
      return [['right'], ['sharpRight', 'slightRight']];
    case 3:
      return [['sharpRight'], ['right']];
    case -7:
      return [['slightLeft', 'left'], ['straight']];
    case 7:
      return [['slightRight', 'right'], ['straight']];
    case -8:
    case 8:
    case -98:
      return [['uTurn'], ['right']];
    case 6:
      if (exitAngleDeg === undefined) return null;
      if (exitAngleDeg <= 135) return [['left', 'slightLeft', 'sharpLeft']];
      if (exitAngleDeg < 225) return [['straight']];
      return [['right', 'sharpRight', 'slightRight', 'uTurn']];
    default:
      return null;
  }
}

/**
 * The lanes with the ones to be in marked, or null when that says nothing: no lane suits the turn
 * (the markings and the route disagree, so better nothing than a wrong lane), or every lane does.
 */
export function lanesForTurn(lanes: readonly LaneDirection[][], sign: number, exitAngleDeg?: number): Lane[] | null {
  const prefs = lanePreferences(sign, exitAngleDeg);
  if (!prefs) return null;
  for (const group of prefs) {
    const valid = lanes.map((dirs) => dirs.some((d) => group.includes(d)));
    const count = valid.filter(Boolean).length;
    if (count === 0) continue;
    if (count === lanes.length) return null;
    return lanes.map((directions, i) => ({ directions: [...directions], valid: valid[i]! }));
  }
  return null;
}

/** How far along a line a point lies, in metres. */
function alongM(line: readonly LngLat[], p: LngLat): { m: number; offM: number } {
  let best = { m: 0, offM: Infinity };
  let cum = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = haversineM(line[i]!, line[i + 1]!);
    const proj = projectOntoSegment(p, line[i]!, line[i + 1]!);
    if (proj.distanceM < best.offM) best = { m: cum + seg * proj.t, offM: proj.distanceM };
    cum += seg;
  }
  return best;
}

/** A point this far from a way's line isn't on it. */
const ON_WAY_M = 20;
/** The turn must be this close to the end of the way: its lanes are the ones at its end. */
export const LANES_AT_END_M = 30;

/**
 * The lanes a route uses on a way to make a turn at `turnAt`, having come along it from `cameFrom`,
 * or null: the way's lanes in the direction travelled, and only where the turn is at the way's end.
 */
export function approachLanes(way: WayLanes, cameFrom: LngLat, turnAt: LngLat): LaneDirection[][] | null {
  if (way.coords.length < 2) return null;
  const a = alongM(way.coords, cameFrom);
  const b = alongM(way.coords, turnAt);
  if (a.offM > ON_WAY_M || b.offM > ON_WAY_M || a.m === b.m) return null;
  const forward = b.m > a.m;
  const end = forward ? way.coords.at(-1)! : way.coords[0]!;
  if (haversineM(turnAt, end) > LANES_AT_END_M) return null;
  return parseTurnLanes(forward ? way.forward : way.backward);
}

type WayRun = readonly [number, number, number];

/**
 * A route's turns with the lanes for each, where the road leading to it has its lanes mapped: the
 * way the route is on just before the turn, the direction it goes along it, and which of its lanes
 * suit the turn.
 */
export function withLanes<I extends { sign: number; interval: [number, number]; exitAngleDeg?: number | undefined }>(
  instructions: readonly I[],
  coords: readonly LngLat[],
  wayRuns: readonly WayRun[],
  lanesOf: (wayId: number) => WayLanes | undefined,
): Array<I & { lanes?: Lane[] }> {
  return instructions.map((ins, k) => {
    const at = ins.interval[0];
    if (k === 0 || at <= 0 || at >= coords.length) return ins;
    // The way that leads into the turn covers the segment just before it.
    const run = wayRuns.find(([from, to]) => from < at && at <= to);
    const way = run ? lanesOf(run[2]) : undefined;
    if (!run || !way) return ins;
    const marked = approachLanes(way, coords[Math.max(run[0], at - 1)]!, coords[at]!);
    const lanes = marked ? lanesForTurn(marked, ins.sign, ins.exitAngleDeg) : null;
    return lanes ? { ...ins, lanes } : ins;
  });
}

const NUMBER_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/**
 * Which lanes to be in, in words: "Use the left lane", "Use the right two lanes", "Use the middle
 * lane", or by count from the left where they're spread out. Null when no lane is marked.
 */
export function laneAdvice(lanes: readonly Pick<Lane, 'valid'>[]): string | null {
  const valid = lanes.flatMap((l, i) => (l.valid ? [i] : []));
  const n = valid.length;
  if (n === 0 || n === lanes.length) return null;
  const together = valid.at(-1)! - valid[0]! === n - 1;
  const count = NUMBER_WORD[n] ?? String(n);
  if (together && valid[0] === 0) return n === 1 ? 'Use the left lane' : `Use the left ${count} lanes`;
  if (together && valid.at(-1) === lanes.length - 1) return n === 1 ? 'Use the right lane' : `Use the right ${count} lanes`;
  if (n === 1 && lanes.length === 3) return 'Use the middle lane';
  const which = valid.map((i) => ORDINAL[i] ?? String(i + 1));
  const list = which.length === 1 ? which[0] : `${which.slice(0, -1).join(', ')} or ${which.at(-1)}`;
  return `Use the ${list} lane from the left`;
}
