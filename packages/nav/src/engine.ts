import { type LngLat, bearingDeg, destination, haversineM, projectOntoSegment } from '@wayfinder/shared/geo';
import { AT_LIGHTS_BEFORE_M, atNthLights } from '@wayfinder/shared/road-facts';
import { type LightAhead, type LightTiming, lightWaitText, lightsAhead, remainingWaitS } from '@wayfinder/shared/light-timing';
import type { Instruction, Mode, Route } from '@wayfinder/shared/schemas';
import { announcementText } from './phrasing.js';

export interface NavFix {
  /** Epoch ms */
  ts: number;
  lon: number;
  lat: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
}

export interface NavConfig {
  /** Distance from the route line beyond which a fix counts as off route. */
  offRouteThresholdM: number;
  /** Consecutive off-route fixes before asking for a reroute. */
  offRouteConsecutive: number;
  /** Distances before a manoeuvre at which to speak, largest first. */
  announceDistancesM: number[];
  arrivalRadiusM: number;
}

export const NAV_CONFIG: Record<Mode, NavConfig> = {
  car: { offRouteThresholdM: 40, offRouteConsecutive: 3, announceDistancesM: [800, 200, 40], arrivalRadiusM: 30 },
  foot: { offRouteThresholdM: 25, offRouteConsecutive: 3, announceDistancesM: [50, 12], arrivalRadiusM: 15 },
};

export type NavEvent =
  | { type: 'announce'; text: string; instructionIndex: number; thresholdM: number }
  | { type: 'viaReached'; viaIndex: number }
  | { type: 'offRoute'; from: LngLat; to: LngLat; remainingVia: LngLat[] }
  | { type: 'backOnRoute' }
  | { type: 'arrived' };

export type NavStatus = 'navigating' | 'offRoute' | 'arrived';

/** GraphHopper's sign for "Arrive at destination". */
const DESTINATION_SIGN = 4;

export interface NavState {
  status: NavStatus;
  /** Fix snapped to the route, or null before the first fix. */
  snapped: LngLat | null;
  distanceFromRouteM: number;
  progressM: number;
  remainingDistanceM: number;
  remainingDurationS: number;
  currentInstruction: Instruction | null;
  nextInstruction: Instruction | null;
  nextInstructionIndex: number | null;
  distanceToNextManeuverM: number | null;
  /** Speed limit where you are, in km/h, or null where it isn't known. */
  speedLimitKmh: number | null;
  /** The limit is the legal default for the kind of road, not one signposted in the map data. */
  speedLimitEstimated: boolean;
  /** Lights ahead whose timing drives have shown, each red where you'll likely have to stop, green where not. */
  lightsAhead: LightAhead[];
  /** Stopped at a set of lights with a known timing: about how much longer it usually takes, e.g. "Usually about 20 s more". */
  lightWait: string | null;
}

/** Slower than this is stopped, for the wait at the lights. */
const STOPPED_MPS = 0.8;
/** Stopped within this far before a set of lights is waiting at it. */
const WAITING_AT_LIGHTS_M = 60;
/**
 * The phone asks for a fix every second or every 5 m, so a car standing still sends none. This long
 * without a fix, after one slower than SLOWING_MPS, is standing still.
 */
const SILENT_MS = 3000;
const SLOWING_MPS = 7;

export class NavigationSession {
  readonly mode: Mode;
  private route!: Route;
  private config: NavConfig;
  private cum: number[] = [];
  private instructionStart: number[] = [];
  private instructionEnd: number[] = [];
  private viaProgress: number[] = [];
  private viaPassed = new Set<number>();
  /** How far along the route each set of lights is (ramp meters aside). */
  private lightsAt: number[] = [];
  /** The timed sets of lights, by how far along the route they are. */
  private timedLights: Array<{ m: number; timing: LightTiming }> = [];
  /** When the car came to a stop, while it's stopped. */
  private stoppedSince: number | null = null;
  /** The last fix followed on the route, for telling a car standing still from one still moving. */
  private lastFix: NavFix | null = null;
  private announced = new Set<string>();
  private lastSegment = 0;
  private lastProgress = 0;
  private offRouteCount = 0;
  private state: NavState;

  constructor(route: Route, config?: Partial<NavConfig>) {
    this.mode = route.mode;
    this.config = { ...NAV_CONFIG[route.mode], ...config };
    this.load(route);
    this.state = this.initialState();
  }

  get currentRoute(): Route {
    return this.route;
  }

  get snapshot(): NavState {
    return this.state;
  }

  /** Swap in a rerouted route; announcements and progress restart, passed vias stay passed. */
  replaceRoute(route: Route): void {
    const passedCount = this.viaPassed.size;
    this.load(route);
    // Rerouted routes contain only the remaining vias; keep indices meaningful for callers.
    this.viaPassed = new Set();
    this.viaOffset += passedCount;
    this.state = this.initialState();
  }

  private viaOffset = 0;

  private load(route: Route) {
    if (route.geometry.length < 2) throw new Error('Route geometry needs at least two points');
    this.route = route;
    this.cum = [0];
    for (let i = 1; i < route.geometry.length; i++) {
      this.cum.push(this.cum[i - 1]! + haversineM(route.geometry[i - 1]!, route.geometry[i]!));
    }
    this.instructionStart = route.instructions.map((ins) => this.cum[Math.min(ins.interval[0], this.cum.length - 1)]!);
    this.instructionEnd = route.instructions.map((ins) => this.cum[Math.min(ins.interval[1], this.cum.length - 1)]!);
    this.viaProgress = [];
    let from = 0;
    for (const via of route.viaPoints) {
      let best = from;
      let bestD = Infinity;
      for (let i = from; i < route.geometry.length; i++) {
        const d = haversineM(via, route.geometry[i]!);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.viaProgress.push(this.cum[best]!);
      from = best;
    }
    this.lightsAt = (route.trafficSignals ?? []).filter((s) => s.kind !== 'ramp_meter').map((s) => this.cum[Math.min(s.index, this.cum.length - 1)]!);
    this.timedLights = (route.trafficSignals ?? []).flatMap((s) => (s.timing ? [{ m: this.cum[Math.min(s.index, this.cum.length - 1)]!, timing: s.timing }] : []));
    this.stoppedSince = null;
    this.lastFix = null;
    this.announced = new Set();
    this.lastSegment = 0;
    this.lastProgress = 0;
    this.offRouteCount = 0;
  }

  private get totalM(): number {
    return this.cum[this.cum.length - 1]!;
  }

  private initialState(): NavState {
    return {
      status: 'navigating',
      snapped: null,
      distanceFromRouteM: 0,
      progressM: 0,
      remainingDistanceM: this.totalM,
      remainingDurationS: this.route.durationS,
      currentInstruction: this.route.instructions[0] ?? null,
      nextInstruction: this.route.instructions[1] ?? null,
      nextInstructionIndex: this.route.instructions.length > 1 ? 1 : null,
      distanceToNextManeuverM: this.instructionStart[1] ?? null,
      speedLimitKmh: null,
      speedLimitEstimated: false,
      lightsAhead: lightsAhead(this.route, this.cum, 0, Date.now()),
      lightWait: null,
    };
  }

  /**
   * Called every second or so between fixes: a car that slowed just short of a set of lights and has
   * sent no fix since is waiting there (the phone sends none standing still), so how much longer is
   * counted on from the time, not only from fixes.
   */
  tick(nowMs: number): NavState {
    const last = this.lastFix;
    if (this.mode !== 'car' || this.state.status !== 'navigating' || !last || nowMs - last.ts < SILENT_MS) return this.state;
    const speed = last.speedMps;
    if (speed === null || speed === undefined || !Number.isFinite(speed) || speed > SLOWING_MPS) return this.state;
    const lightWait = this.waitText(this.state.progressM, (this.stoppedSince ??= last.ts), nowMs);
    if (lightWait !== this.state.lightWait) this.state = { ...this.state, lightWait };
    return this.state;
  }

  private waitText(progress: number, since: number, nowMs: number): string | null {
    const at = this.timedLights.find((l) => l.m >= progress - 5 && l.m - progress <= WAITING_AT_LIGHTS_M);
    if (!at || at.timing.waits.length === 0) return null;
    return lightWaitText(remainingWaitS(at.timing, (nowMs - since) / 1000));
  }

  /** Stopped just before a set of lights with a known timing: about how much longer, from how long you've waited. */
  private waitAtLights(fix: NavFix, progress: number): string | null {
    this.lastFix = fix;
    const speed = fix.speedMps;
    if (speed === null || speed === undefined || !Number.isFinite(speed) || speed > STOPPED_MPS) {
      this.stoppedSince = null;
      return null;
    }
    return this.waitText(progress, (this.stoppedSince ??= fix.ts), fix.ts);
  }

  /** The limit on route segment i (between geometry points i and i + 1): signposted first, else estimated. */
  private speedLimitOn(segment: number): { kmh: number | null; estimated: boolean } {
    const on = (runs: Route['speedLimits']) => runs?.find((r) => r.from <= segment && segment < r.to)?.kmh ?? null;
    const signed = on(this.route.speedLimits);
    if (signed !== null) return { kmh: signed, estimated: false };
    const guess = on(this.route.estimatedSpeedLimits);
    return { kmh: guess, estimated: guess !== null };
  }

  /** Sets of lights between here and a turn at the lights (not counting the turn's own). */
  private lightsBefore(progressM: number, turnM: number): number {
    return this.lightsAt.filter((m) => m > progressM + 5 && m < turnM - AT_LIGHTS_BEFORE_M).length;
  }

  /** Find the best segment for p, preferring forward progress near the last match. */
  private snap(p: LngLat): { segment: number; point: LngLat; distanceM: number; progressM: number } {
    const g = this.route.geometry;
    type Match = { segment: number; point: LngLat; distanceM: number; progressM: number; cost: number };
    const evaluate = (lo: number, hi: number): Match | null => {
      let best: Match | null = null;
      for (let i = Math.max(0, lo); i < Math.min(g.length - 1, hi); i++) {
        const proj = projectOntoSegment(p, g[i]!, g[i + 1]!);
        const progressM = this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * proj.t;
        // Penalise matches that jump backwards along the route (e.g. an overlapping loop section)
        // or far ahead of the last match.
        const backwards = Math.max(0, this.lastProgress - progressM - 30);
        const ahead = Math.max(0, progressM - this.lastProgress - 2000);
        const cost = proj.distanceM + backwards * 0.5 + ahead * 0.05;
        if (!best || cost < best.cost) {
          best = { segment: i, point: proj.point, distanceM: proj.distanceM, progressM, cost };
        }
      }
      return best;
    };
    const local = evaluate(this.lastSegment - 3, this.lastSegment + 80);
    if (local && local.distanceM <= this.config.offRouteThresholdM) return local;
    const global = evaluate(0, g.length - 1)!;
    return local && local.cost <= global.cost ? local : global;
  }

  update(fix: NavFix): { state: NavState; events: NavEvent[] } {
    const events: NavEvent[] = [];
    if (this.state.status === 'arrived') return { state: this.state, events };
    const p: LngLat = [fix.lon, fix.lat];
    const snap = this.snap(p);
    const tolerance = this.config.offRouteThresholdM + Math.min(fix.accuracyM ?? 0, 20);

    if (snap.distanceM > tolerance) {
      this.offRouteCount++;
      if (this.offRouteCount >= this.config.offRouteConsecutive && this.state.status !== 'offRoute') {
        const destinationPt = this.route.geometry[this.route.geometry.length - 1]!;
        const remainingVia = this.route.viaPoints.filter((_, i) => !this.viaPassed.has(i));
        events.push({ type: 'offRoute', from: p, to: destinationPt, remainingVia });
        this.state = { ...this.state, status: 'offRoute', distanceFromRouteM: snap.distanceM };
      } else {
        this.state = { ...this.state, distanceFromRouteM: snap.distanceM };
      }
      return { state: this.state, events };
    }

    if (this.state.status === 'offRoute') events.push({ type: 'backOnRoute' });
    this.offRouteCount = 0;
    this.lastSegment = snap.segment;
    this.lastProgress = Math.max(this.lastProgress - 30, snap.progressM);
    const progress = snap.progressM;

    // Vias
    this.viaProgress.forEach((vp, i) => {
      if (!this.viaPassed.has(i) && progress >= vp - 20) {
        this.viaPassed.add(i);
        events.push({ type: 'viaReached', viaIndex: i + this.viaOffset });
      }
    });

    const ins = this.route.instructions;
    let current = 0;
    for (let i = 0; i < ins.length; i++) if (this.instructionStart[i]! <= progress + 1) current = i;
    const nextIdx = current + 1 < ins.length ? current + 1 : null;
    const distanceToNext = nextIdx !== null ? Math.max(0, this.instructionStart[nextIdx]! - progress) : null;

    if (nextIdx !== null && distanceToNext !== null) {
      const next = ins[nextIdx]!;
      const crossed = this.config.announceDistancesM.filter(
        (d) => distanceToNext <= d && !this.announced.has(`${nextIdx}:${d}`),
      );
      if (crossed.length > 0) {
        // Speak only the closest threshold; mark the farther ones as done.
        const smallest = Math.min(...crossed);
        for (const d of this.config.announceDistancesM) {
          if (d >= smallest) this.announced.add(`${nextIdx}:${d}`);
        }
        const isFinal = smallest === Math.min(...this.config.announceDistancesM);
        // Arriving is said once, by the 'arrived' event: a "now" announcement of the destination
        // just before it would say it twice.
        if (!(isFinal && next.sign === DESTINATION_SIGN)) {
          // "At the third set of lights, turn left": which lights, counted from here.
          const said = next.atTrafficLights ? { ...next, text: atNthLights(next.text, this.lightsBefore(progress, this.instructionStart[nextIdx]!)) } : next;
          events.push({
            type: 'announce',
            text: announcementText(said, isFinal ? null : distanceToNext),
            instructionIndex: nextIdx,
            thresholdM: smallest,
          });
        }
      }
    }

    let remainingDurationS = 0;
    for (let i = 0; i < ins.length; i++) {
      const s = this.instructionStart[i]!;
      const e = this.instructionEnd[i]!;
      if (e <= progress) continue;
      const frac = e - s > 0 ? Math.min(1, (e - Math.max(s, progress)) / (e - s)) : 0;
      remainingDurationS += ins[i]!.durationS * frac;
    }
    const remainingDistanceM = Math.max(0, this.totalM - progress);

    let status: NavStatus = 'navigating';
    const end = this.route.geometry[this.route.geometry.length - 1]!;
    if (remainingDistanceM <= this.config.arrivalRadiusM || haversineM(p, end) <= this.config.arrivalRadiusM) {
      // Only count as arrived once all vias are passed (round trips start where they end).
      if (this.viaPassed.size >= this.viaProgress.length) {
        status = 'arrived';
        events.push({ type: 'arrived' });
      }
    }

    const limit = status === 'arrived' ? { kmh: null, estimated: false } : this.speedLimitOn(snap.segment);
    const driving = status !== 'arrived' && this.mode === 'car';
    this.state = {
      status,
      snapped: snap.point,
      distanceFromRouteM: snap.distanceM,
      progressM: progress,
      remainingDistanceM: status === 'arrived' ? 0 : remainingDistanceM,
      remainingDurationS: status === 'arrived' ? 0 : remainingDurationS,
      currentInstruction: ins[current] ?? null,
      nextInstruction: nextIdx !== null ? ins[nextIdx]! : null,
      nextInstructionIndex: nextIdx,
      distanceToNextManeuverM: distanceToNext,
      speedLimitKmh: limit.kmh,
      speedLimitEstimated: limit.estimated,
      lightsAhead: driving ? lightsAhead(this.route, this.cum, progress, fix.ts) : [],
      lightWait: driving ? this.waitAtLights(fix, progress) : null,
    };
    return { state: this.state, events };
  }
}

/**
 * Generate fixes travelling along a polyline at a constant speed, optionally offset sideways
 * (to simulate GPS error or a wrong turn). Useful for tests and the mobile demo mode.
 */
export function simulateFixes(
  line: readonly LngLat[],
  opts: { speedMps: number; intervalS: number; startTs?: number; lateralOffsetM?: number },
): NavFix[] {
  const fixes: NavFix[] = [];
  const step = opts.speedMps * opts.intervalS;
  let ts = opts.startTs ?? 0;
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = haversineM(a, b);
    const brg = bearingDeg(a, b);
    let d = carry;
    while (d <= len) {
      let pt = destination(a, brg, d);
      if (opts.lateralOffsetM) pt = destination(pt, (brg + 90) % 360, opts.lateralOffsetM);
      fixes.push({ ts, lon: pt[0], lat: pt[1], accuracyM: 5, speedMps: opts.speedMps, headingDeg: brg });
      ts += opts.intervalS * 1000;
      d += step;
    }
    carry = d - len;
  }
  const last = line[line.length - 1]!;
  fixes.push({ ts, lon: last[0], lat: last[1], accuracyM: 5, speedMps: 0 });
  return fixes;
}
