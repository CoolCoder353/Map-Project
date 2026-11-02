/**
 * What the map knows about the roads a route uses beyond what the routing engine says: traffic
 * lights, and how long the route really takes. Pure functions over route geometry, used by the
 * server to finish each route and by the turn-by-turn engine to say which set of lights to turn at.
 */
import { type LngLat, type SpeedLimitRun, haversineM, projectOntoSegment } from './geo.js';
import { type LightTiming, expectedDelayS } from './light-timing.js';

/** `signals` a junction's lights, `crossing` lights for people crossing, `ramp_meter` a motorway on-ramp's. */
export type SignalKind = 'signals' | 'crossing' | 'ramp_meter';

export interface MappedSignal {
  /** The OSM node, where known. */
  id?: string;
  lon: number;
  lat: number;
  kind: SignalKind;
}

/**
 * A set of lights on a route: the route point nearest it, and what kind it is. `id` is the first of
 * its mapped lights along the route (the one an approach meets first, so the same each time), and
 * `timing` how long it usually holds a car going this way at this time, where drives have shown it.
 */
export interface RouteSignal {
  index: number;
  kind: SignalKind;
  id?: string;
  timing?: LightTiming;
}

/** How far from the route line a mapped light can be and still be on it (the stop line is off the centre line). */
export const SIGNAL_MATCH_M = 12;
/** Lights closer together than this along the route are one set (one per approach at a junction). */
export const SIGNAL_SET_M = 40;
/** A turn this far past a set of lights, or this far before it, is a turn at the lights. */
export const AT_LIGHTS_BEFORE_M = 35;
const AT_LIGHTS_AFTER_M = 15;

/**
 * Average wait at each kind of light, for the time a drive takes: about half the time a junction's
 * lights are red as you get there, and then for some of a cycle, less where lights along a main road
 * are timed together. A pedestrian crossing is red for a car less often and for less long; a ramp
 * meter holds each car for a few seconds to a quarter-minute.
 */
export const SIGNAL_DELAY_S: Record<SignalKind, number> = { signals: 15, crossing: 6, ramp_meter: 10 };

/** Cumulative distance along a line at each of its points. */
export function cumulativeM(coords: readonly LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + haversineM(coords[i - 1]!, coords[i]!));
  return cum;
}

const KIND_RANK: Record<SignalKind, number> = { signals: 3, crossing: 2, ramp_meter: 1 };

/**
 * The sets of lights a route passes, in order. A light counts when it lies within SIGNAL_MATCH_M of
 * the route, except beside a segment `skipSegment` rules out (a bridge or tunnel, which passes over
 * or under a junction's lights without stopping at them). Lights within SIGNAL_SET_M of each other
 * along the route are one set, of the most junction-like kind among them.
 */
export function signalsAlongRoute(
  coords: readonly LngLat[],
  signals: readonly MappedSignal[],
  skipSegment: (segment: number) => boolean = () => false,
): RouteSignal[] {
  if (coords.length < 2 || signals.length === 0) return [];
  const cum = cumulativeM(coords);
  // Segments by grid cell (~110 m), each in every cell its padded box touches, so a light is only
  // checked against the segments near it: a long route can pass thousands of mapped lights.
  const CELL = 0.001;
  const pad = (SIGNAL_MATCH_M / 111_000) * 2;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const [x0, x1] = [Math.floor((Math.min(a[0], b[0]) - pad) / CELL), Math.floor((Math.max(a[0], b[0]) + pad) / CELL)];
    const [y0, y1] = [Math.floor((Math.min(a[1], b[1]) - pad) / CELL), Math.floor((Math.max(a[1], b[1]) + pad) / CELL)];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  }
  const found: Array<{ progressM: number; index: number; kind: SignalKind; id?: string }> = [];
  for (const s of signals) {
    const p: LngLat = [s.lon, s.lat];
    let best: { d: number; segment: number; t: number } | null = null;
    for (const i of grid.get(`${Math.floor(s.lon / CELL)}:${Math.floor(s.lat / CELL)}`) ?? []) {
      const proj = projectOntoSegment(p, coords[i]!, coords[i + 1]!);
      if (proj.distanceM <= SIGNAL_MATCH_M && (!best || proj.distanceM < best.d)) best = { d: proj.distanceM, segment: i, t: proj.t };
    }
    if (!best || skipSegment(best.segment)) continue;
    const progressM = cum[best.segment]! + (cum[best.segment + 1]! - cum[best.segment]!) * best.t;
    found.push({ progressM, index: best.t > 0.5 ? best.segment + 1 : best.segment, kind: s.kind, ...(s.id ? { id: s.id } : {}) });
  }
  found.sort((a, b) => a.progressM - b.progressM);
  const sets: Array<{ startM: number; index: number; kind: SignalKind; id?: string }> = [];
  for (const f of found) {
    const last = sets.at(-1);
    if (last && f.progressM - last.startM < SIGNAL_SET_M) {
      if (KIND_RANK[f.kind] > KIND_RANK[last.kind]) last.kind = f.kind;
      continue;
    }
    sets.push({ startM: f.progressM, index: f.index, kind: f.kind, ...(f.id ? { id: f.id } : {}) });
  }
  return sets.map(({ index, kind, id }) => ({ index, kind, ...(id ? { id } : {}) }));
}

/** GraphHopper signs for turns (sharp, ordinary and slight, each way). Keeping left or right isn't a turn at the lights. */
const TURN_SIGNS = new Set([-3, -2, -1, 1, 2, 3]);

export const AT_THE_LIGHTS = 'At the lights';

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

interface TurnLike {
  sign: number;
  text: string;
  interval: [number, number];
  atTrafficLights?: boolean;
}

/**
 * Turns made at a set of lights say so: "At the lights, turn left onto Old Cleveland Road". Ramp
 * meters aren't the lights people steer by, so they don't count.
 */
export function markTurnsAtLights<T extends TurnLike>(instructions: readonly T[], coords: readonly LngLat[], signals: readonly RouteSignal[]): T[] {
  const lights = signals.filter((s) => s.kind !== 'ramp_meter');
  if (lights.length === 0) return [...instructions];
  const cum = cumulativeM(coords);
  const at = (i: number) => cum[Math.min(Math.max(i, 0), cum.length - 1)]!;
  return instructions.map((ins) => {
    if (!TURN_SIGNS.has(ins.sign)) return ins;
    const turnM = at(ins.interval[0]);
    const atLights = lights.some((s) => {
      const d = turnM - at(s.index);
      return d >= -AT_LIGHTS_AFTER_M && d <= AT_LIGHTS_BEFORE_M;
    });
    return atLights ? { ...ins, atTrafficLights: true, text: `${AT_THE_LIGHTS}, ${lowerFirst(ins.text)}` } : ins;
  });
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth'];

/**
 * A turn at the lights said from further back, with sets of lights still to pass before it: "At the
 * third set of lights, turn right…". Up to three sets before; beyond that, counting them is no help.
 * `lightsBefore` is how many sets the driver passes first.
 */
export function atNthLights(text: string, lightsBefore: number): string {
  if (!text.startsWith(AT_THE_LIGHTS) || lightsBefore < 1 || lightsBefore > 3) return text;
  return `At the ${ORDINALS[lightsBefore + 1]} set of lights${text.slice(AT_THE_LIGHTS.length)}`;
}

/** Learned average speed on a way, in km/h, or null where there aren't enough trips to say. */
export type LearnedSpeed = (wayId: number) => number | null;

export interface TravelTimeInput {
  coords: readonly LngLat[];
  instructions: ReadonlyArray<{ interval: [number, number]; durationS: number }>;
  /** The engine's time for each stretch, [first point, last point, milliseconds]; null to share each instruction's time out by distance. */
  timeRuns: ReadonlyArray<readonly [number, number, number]> | null;
  wayRuns: ReadonlyArray<readonly [number, number, number]>;
  learned: LearnedSpeed;
  signals: readonly RouteSignal[];
}

export interface TravelTime {
  totalS: number;
  /** Each instruction's time, in the same order. */
  instructionS: number[];
  /** How much longer the roads with learned speeds take than the engine thinks. */
  learnedExtraS: number;
  /** The engine's own time for those roads. */
  learnedEngineS: number;
}

/**
 * How long a route takes: the engine's time for each stretch, replaced by the time trips actually
 * took where enough of them have driven that road at this time of day, plus a wait at each set of
 * lights: what drives going that way through it usually lose there where that's known, else a
 * typical wait for its kind. Learned times already include their lights, so those roads add no wait.
 */
export function travelTime(input: TravelTimeInput): TravelTime {
  const { coords } = input;
  const n = Math.max(0, coords.length - 1);
  const segLen = Array.from({ length: n }, (_, i) => haversineM(coords[i]!, coords[i + 1]!));
  const engine = new Array<number>(n).fill(0);
  const share = (from: number, to: number, seconds: number) => {
    const total = segLen.slice(from, to).reduce((a, b) => a + b, 0);
    for (let i = from; i < to && i < n; i++) engine[i] = total > 0 ? (seconds * segLen[i]!) / total : seconds / Math.max(1, to - from);
  };
  if (input.timeRuns && input.timeRuns.length > 0) for (const [from, to, ms] of input.timeRuns) share(from, to, ms / 1000);
  else for (const ins of input.instructions) share(ins.interval[0], ins.interval[1], ins.durationS);

  const way = new Array<number | null>(n).fill(null);
  for (const [from, to, id] of input.wayRuns) for (let i = from; i < to && i < n; i++) way[i] = id;
  const seg = engine.slice();
  const learnedSeg = new Array<boolean>(n).fill(false);
  let learnedExtraS = 0;
  let learnedEngineS = 0;
  for (let i = 0; i < n; i++) {
    const id = way[i];
    const kmh = id !== null && id !== undefined ? input.learned(id) : null;
    if (kmh === null || !(kmh > 0)) continue;
    seg[i] = segLen[i]! / (kmh / 3.6);
    learnedSeg[i] = true;
    learnedExtraS += seg[i]! - engine[i]!;
    learnedEngineS += engine[i]!;
  }
  for (const s of input.signals) {
    // The wait is spent on the stretch arriving at the lights.
    const i = Math.min(Math.max(s.index - 1, 0), n - 1);
    if (n > 0 && !learnedSeg[i]) seg[i] = seg[i]! + (s.timing ? expectedDelayS(s.timing) : SIGNAL_DELAY_S[s.kind]);
  }
  const instructionS = input.instructions.map((ins) => seg.slice(ins.interval[0], ins.interval[1]).reduce((a, b) => a + b, 0));
  return { totalS: seg.reduce((a, b) => a + b, 0), instructionS, learnedExtraS, learnedEngineS };
}

/** A route is "usually slow at this time" when trips on its roads take this much longer than the engine expects. */
export const USUALLY_SLOW_MIN_S = 120;
export const USUALLY_SLOW_FRACTION = 0.15;

export const usuallySlow = (t: TravelTime, engineTotalS: number) =>
  t.learnedExtraS >= USUALLY_SLOW_MIN_S && t.learnedExtraS >= USUALLY_SLOW_FRACTION * engineTotalS;

type Run = readonly [number, number, number | null];

/**
 * Split the engine's `max_speed` runs into the limits that are signposted and the ones it estimated
 * from the legal default for that kind of road (`max_speed_estimated` runs, true where estimated).
 * Where the engine sends no estimate flags every limit is taken as signposted, as before.
 */
export function splitEstimatedLimits(
  limits: readonly Run[],
  estimated: ReadonlyArray<readonly [number, number, boolean | null]>,
): { signed: Array<[number, number, number | null]>; estimated: Array<[number, number, number | null]> } {
  const signed: Array<[number, number, number | null]> = [];
  const guessed: Array<[number, number, number | null]> = [];
  if (estimated.length === 0) return { signed: limits.map(([a, b, v]) => [a, b, v]), estimated: [] };
  for (const [from, to, kmh] of limits) {
    let at = from;
    for (const [ef, et, isEstimate] of estimated) {
      const a = Math.max(from, ef);
      const b = Math.min(to, et);
      if (b <= a) continue;
      if (a > at) signed.push([at, a, kmh]);
      (isEstimate ? guessed : signed).push([a, b, kmh]);
      if (isEstimate) signed.push([a, b, null]);
      at = b;
    }
    if (at < to) signed.push([at, to, kmh]);
  }
  return { signed, estimated: guessed };
}

/**
 * Change the engine's limits where a road's own rules say otherwise: a school zone's lower limit while
 * it's in force, or no limit at all on a road whose signs change with traffic (a motorway's electronic
 * signs, which a map can't know).
 */
export function applyWayLimitRules(
  limits: readonly Run[],
  wayRuns: ReadonlyArray<readonly [number, number, number]>,
  ruleFor: (wayId: number) => { kmh: number } | 'variable' | null,
): Array<[number, number, number | null]> {
  if (wayRuns.length === 0) return limits.map(([a, b, v]) => [a, b, v]);
  const out: Array<[number, number, number | null]> = [];
  for (const [from, to, kmh] of limits) {
    let at = from;
    for (const [wf, wt, id] of wayRuns) {
      const a = Math.max(from, wf);
      const b = Math.min(to, wt);
      if (b <= a) continue;
      const rule = ruleFor(id);
      if (!rule) continue;
      if (a > at) out.push([at, a, kmh]);
      out.push([a, b, rule === 'variable' ? null : rule.kmh]);
      at = b;
    }
    if (at < to) out.push([at, to, kmh]);
  }
  return out;
}

/** Drop runs that a newer list already covers, e.g. estimates on a road that has a school zone. */
export function withoutCovered(runs: readonly SpeedLimitRun[], cover: readonly SpeedLimitRun[]): SpeedLimitRun[] {
  return runs.filter((r) => !cover.some((c) => c.from < r.to && r.from < c.to));
}

/** Shown with a route whose roads are usually slow at this time. */
export const USUALLY_SLOW_TEXT = 'Usually slow at this time';

/** Roads important enough always to be signposted: a limit guessed for one from the legal default is a poor guess. */
export const MAIN_ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
/** How far along the same road a signposted limit is carried to a stretch with none mapped. */
const CARRY_LIMIT_M = 2000;

type TextRun = readonly [number, number, string | null];

/**
 * Estimated limits on main roads, mended. The engine estimates a stretch with no limit mapped from
 * the legal default for a built-up area (50), but a highway is always signposted, usually higher:
 * there the same road's signposted limit on either side, within CARRY_LIMIT_M, is a better guess,
 * and with none the stretch is better shown with no limit than a wrong one. The same road is the
 * same route number (`refs`), else the same name; smaller roads keep the legal default.
 */
export function mainRoadEstimates(
  estimated: readonly Run[],
  signed: readonly Run[],
  roadClass: readonly TextRun[],
  names: readonly TextRun[],
  refs: readonly TextRun[],
  coords: readonly LngLat[],
): Array<[number, number, number | null]> {
  const n = coords.length - 1;
  if (n < 1 || roadClass.length === 0) return estimated.map(([a, b, v]) => [a, b, v]);
  const perSegment = <T>(runs: ReadonlyArray<readonly [number, number, T]>): Array<T | null> => {
    const out = new Array<T | null>(n).fill(null);
    for (const [a, b, v] of runs) for (let i = a; i < b && i < n; i++) out[i] = v;
    return out;
  };
  const signs = perSegment(signed);
  const classes = perSegment(roadClass);
  const nameOf = perSegment(names);
  const refOf = perSegment(refs);
  const road = (i: number) => refOf[i] || nameOf[i] || null;
  const len = Array.from({ length: n }, (_, i) => haversineM(coords[i]!, coords[i + 1]!));
  const carried = (i: number): number | null => {
    const key = road(i);
    if (!key) return null;
    for (const dir of [-1, 1]) {
      let d = 0;
      for (let j = i + dir; j >= 0 && j < n && road(j) === key; j += dir) {
        if (signs[j] !== null && signs[j] !== undefined) return signs[j]!;
        d += len[j]!;
        if (d > CARRY_LIMIT_M) break;
      }
    }
    return null;
  };
  const out: Array<[number, number, number | null]> = [];
  for (const [a, b, kmh] of estimated) {
    for (let i = a; i < b && i < n; i++) {
      const v = MAIN_ROAD_CLASSES.has(classes[i] ?? '') ? carried(i) : kmh;
      const last = out.at(-1);
      if (last && last[1] === i && last[2] === v) last[1] = i + 1;
      else out.push([i, i + 1, v]);
    }
  }
  return out;
}
