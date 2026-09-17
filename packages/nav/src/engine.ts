import {
  type Instruction,
  type LngLat,
  type Mode,
  type Route,
  destination,
  haversineM,
  bearingDeg,
  projectOntoSegment,
} from '@wayfinder/shared';
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
}

export class NavigationSession {
  readonly mode: Mode;
  private route!: Route;
  private config: NavConfig;
  private cum: number[] = [];
  private instructionStart: number[] = [];
  private instructionEnd: number[] = [];
  private viaProgress: number[] = [];
  private viaPassed = new Set<number>();
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
    };
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
        events.push({
          type: 'announce',
          text: announcementText(next, isFinal ? null : distanceToNext),
          instructionIndex: nextIdx,
          thresholdM: smallest,
        });
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
