/**
 * How long a set of lights usually holds a car, learned from the group's own drives, and whether
 * you're likely to have to stop at it. Pure functions shared by the server (finishing routes), the
 * turn-by-turn engine (the lights ahead while driving) and the maps that draw them.
 *
 * Lights here mostly adjust their timing to traffic, so the exact second they change can't be known
 * from a few drives. What can be: how often drives going a given way through them had to stop at
 * that time of day, and for how long. Where a set of lights keeps a fixed cycle at some hour (its
 * changes to green line up from day to day), the cycle is learned too, and used for lights just
 * ahead, where the time you'll get there is known to within seconds.
 */
import { type LngLat, bearingDeg, interpolate } from './geo.js';

export type Movement = 'straight' | 'left' | 'right' | 'uturn';

/** A fixed cycle: green starts at `offsetS` seconds past local midnight, then every `cycleS`, for `greenS`. */
export interface LightCycle {
  cycleS: number;
  greenS: number;
  offsetS: number;
  /** The lights' local time minus UTC, in seconds, when the route was made, so a phone needs no time-zone data. */
  utcOffsetS: number;
}

export interface LightTiming {
  /** How often drives going this way at this time had to stop, 0 to 1. */
  stopChance: number;
  /** The usual wait when they did, in seconds. */
  waitS: number;
  /** The waits of drives that stopped: the 10th, 25th, 50th, 75th and 90th percentiles. */
  waits: number[];
  cycle?: LightCycle;
}

/** How far before and after a set of lights the road is looked at to tell which way a drive went through it. */
const TURN_LOOK_M = 30;

/** Which way a line goes through the point `atM` metres along it: the heading it arrives on (one of eight) and the turn it makes. */
export function directionAt(coords: readonly LngLat[], cum: readonly number[], atM: number): string | null {
  const total = cum[cum.length - 1] ?? 0;
  if (coords.length < 2 || total <= 0) return null;
  const before = pointAlong(coords, cum, Math.max(0, atM - TURN_LOOK_M));
  const at = pointAlong(coords, cum, atM);
  const after = pointAlong(coords, cum, Math.min(total, atM + TURN_LOOK_M));
  if (before[0] === at[0] && before[1] === at[1]) return null;
  const inDeg = bearingDeg(before, at);
  if (after[0] === at[0] && after[1] === at[1]) return `${Math.round(inDeg / 45) % 8}straight`;
  const turn = ((bearingDeg(at, after) - inDeg + 540) % 360) - 180;
  const movement: Movement = Math.abs(turn) < 35 ? 'straight' : Math.abs(turn) > 150 ? 'uturn' : turn > 0 ? 'right' : 'left';
  return `${Math.round(inDeg / 45) % 8}${movement}`;
}

/** The point `m` metres along a line. */
export function pointAlong(coords: readonly LngLat[], cum: readonly number[], m: number): LngLat {
  if (m <= 0) return coords[0]!;
  for (let i = 1; i < coords.length; i++) {
    if (cum[i]! >= m) {
      const len = cum[i]! - cum[i - 1]!;
      return len > 0 ? interpolate(coords[i - 1]!, coords[i]!, (m - cum[i - 1]!) / len) : coords[i]!;
    }
  }
  return coords[coords.length - 1]!;
}

/** A fixed cycle is only used for lights you'll reach within this long: further ahead, the arrival time is too rough. */
export const CYCLE_HORIZON_S = 45;

export type LightState = 'red' | 'green';

export interface LightPrediction {
  state: LightState;
  /** Expected wait there, seconds (0 when expected to be green). */
  waitS: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Whether you'll likely have to stop at a set of lights you reach at `arriveMs`, `secondsAway` from
 * now: from its fixed cycle when it has one and it's close, else from how often drives stopped there.
 */
export function predictLight(timing: LightTiming, arriveMs: number, secondsAway: number): LightPrediction {
  const c = timing.cycle;
  if (c && secondsAway <= CYCLE_HORIZON_S) {
    // Cycles are learned against seconds past local midnight, as fixed timing plans restart each day.
    const phase = mod(mod(arriveMs / 1000 + c.utcOffsetS, 86_400) - c.offsetS, c.cycleS);
    return phase < c.greenS ? { state: 'green', waitS: 0 } : { state: 'red', waitS: c.cycleS - phase };
  }
  return timing.stopChance >= 0.5 ? { state: 'red', waitS: timing.waitS } : { state: 'green', waitS: 0 };
}

/** The average time a set of lights adds to a drive: the chance of stopping times the average stop. */
export function expectedDelayS(timing: LightTiming): number {
  const mean = timing.waits.length ? timing.waits.reduce((a, b) => a + b, 0) / timing.waits.length : timing.waitS;
  return timing.stopChance * mean;
}

/**
 * Stopped at the lights for `waitedS` already: about how much longer, counting down from the usual
 * wait there, so it only ever goes down. Null once you've waited about as long as usual (it should
 * change soon).
 */
export function remainingWaitS(timing: LightTiming, waitedS: number): number | null {
  const left = timing.waitS - waitedS;
  return left > 2 ? left : null;
}

/** Shown while stopped at a set of lights with a known wait. Rough on purpose: it's what usually happens, not a countdown. */
export function lightWaitText(remainingS: number | null): string {
  if (remainingS === null || remainingS < 8) return 'Usually changes soon';
  if (remainingS < 60) return `Usually about ${Math.round(remainingS / 5) * 5} s more`;
  return `Usually about ${Math.round(remainingS / 60)} min more`;
}

/** A set of lights ahead with a known timing, and whether you'll likely have to stop there. */
export interface LightAhead {
  at: LngLat;
  /** How far along the route it is. */
  progressM: number;
  state: LightState;
  waitS: number;
}

interface TimedRoute {
  geometry: readonly LngLat[];
  instructions: ReadonlyArray<{ interval: [number, number]; durationS: number }>;
  trafficSignals?: ReadonlyArray<{ index: number; timing?: LightTiming | undefined }> | undefined;
}

/** How far ahead lights are drawn red or green: further than this, there's nothing to act on yet. */
export const LIGHTS_AHEAD_M = 3000;

/**
 * The sets of lights ahead of `progressM` with a known timing, up to `aheadM` on, each with whether
 * you'll likely have to stop there, going by when the route says you'll get there from `nowMs`.
 * `cum` is the route's cumulative distance at each point.
 */
export function lightsAhead(route: TimedRoute, cum: readonly number[], progressM: number, nowMs: number, aheadM = LIGHTS_AHEAD_M): LightAhead[] {
  const out: LightAhead[] = [];
  const last = cum.length - 1;
  if (last < 1) return out;
  const at = (i: number) => cum[Math.min(Math.max(i, 0), last)]!;
  const secondsTo = (m: number) => {
    let s = 0;
    for (const ins of route.instructions) {
      const a = at(ins.interval[0]);
      const b = at(ins.interval[1]);
      const from = Math.max(a, progressM);
      const to = Math.min(b, m);
      if (to > from && b > a) s += (ins.durationS * (to - from)) / (b - a);
    }
    return s;
  };
  for (const sig of route.trafficSignals ?? []) {
    if (!sig.timing) continue;
    const m = at(sig.index);
    if (m < progressM - 5 || m > progressM + aheadM) continue;
    const away = secondsTo(m);
    out.push({ at: route.geometry[Math.min(sig.index, last)]!, progressM: m, ...predictLight(sig.timing, nowMs + away * 1000, away) });
  }
  return out;
}
