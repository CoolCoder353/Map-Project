import {
  type LngLat,
  destination,
  haversineM,
  inEllipse,
  sampleLine,
} from './geo.js';
import { type Cell, VISIT_RES, cellCenter, pointToCell } from './h3.js';

export interface Novelty {
  totalKm: number;
  newKm: number;
  /** 0–100 */
  noveltyPct: number;
}

export interface RouteNovelty extends Novelty {
  /** Unique VISIT_RES cells along the route, in travel order. */
  cells: Cell[];
  /** Share (0–1) of sampled length that re-enters a cell already passed earlier on this route. */
  retraceRatio: number;
}

/**
 * Measure how much of a route runs through cells the user has not visited.
 * The route is sampled every stepM metres; each sample is attributed to the cell of its midpoint.
 */
export function routeNovelty(
  coords: readonly LngLat[],
  isVisited: (cell: Cell) => boolean,
  stepM = 50,
): RouteNovelty {
  let total = 0;
  let fresh = 0;
  let retraced = 0;
  const order: Cell[] = [];
  const seen = new Set<Cell>();
  let current: Cell | undefined;
  let inRetrace = false;
  for (const s of sampleLine(coords, stepM)) {
    const cell = pointToCell(s.point, VISIT_RES);
    total += s.lengthM;
    if (!isVisited(cell)) fresh += s.lengthM;
    if (cell !== current) {
      inRetrace = seen.has(cell);
      if (!inRetrace) {
        seen.add(cell);
        order.push(cell);
      }
      current = cell;
    }
    if (inRetrace) retraced += s.lengthM;
  }
  const totalKm = total / 1000;
  const newKm = fresh / 1000;
  return {
    totalKm,
    newKm,
    noveltyPct: total > 0 ? (fresh / total) * 100 : 0,
    cells: order,
    retraceRatio: total > 0 ? Math.min(1, retraced / total) : 0,
  };
}

/** Overlap between two cell lists relative to the smaller one (0–1). */
export function cellOverlap(a: readonly Cell[], b: readonly Cell[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(large);
  let shared = 0;
  for (const c of small) if (set.has(c)) shared++;
  return shared / small.length;
}

export interface ScoredCandidate<T> {
  candidate: T;
  durationS: number;
  novelty: RouteNovelty;
  score: number;
}

export interface ExploreRankOptions {
  fastestDurationS: number;
  fastestCells: readonly Cell[];
  budgetS: number;
  limit?: number;
  dedupeOverlap?: number;
  /** Score penalty in km per extra minute over the fastest route. */
  kmPenaltyPerExtraMin?: number;
  /** Score penalty in km for each U-turn the route asks the driver to make. */
  kmPenaltyPerUTurn?: number;
}

/**
 * Filter explore candidates to the time budget, drop near-duplicates (of each other and of
 * the fastest route), and rank by new kilometres with a small time penalty.
 */
export function rankExploreCandidates<T>(
  candidates: ReadonlyArray<{ candidate: T; durationS: number; novelty: RouteNovelty; uTurns?: number }>,
  opts: ExploreRankOptions,
): ScoredCandidate<T>[] {
  const limit = opts.limit ?? 3;
  const dedupe = opts.dedupeOverlap ?? 0.8;
  const penalty = opts.kmPenaltyPerExtraMin ?? 0.05;
  const uTurnPenalty = opts.kmPenaltyPerUTurn ?? 8;
  const maxS = opts.fastestDurationS + opts.budgetS;
  const scored = candidates
    .filter((c) => c.durationS <= maxS && c.novelty.newKm > 0)
    .map((c) => ({
      ...c,
      // A detour that doubles back on itself, or turns the driver around, is worth less than its
      // raw new kilometres suggest: people asked for loops, not U-turns at a waypoint.
      score:
        c.novelty.newKm * (1 - 0.5 * c.novelty.retraceRatio) -
        (penalty * Math.max(0, c.durationS - opts.fastestDurationS)) / 60 -
        uTurnPenalty * (c.uTurns ?? 0),
    }))
    .sort((x, y) => y.score - x.score);
  const kept: ScoredCandidate<T>[] = [];
  for (const c of scored) {
    if (cellOverlap(c.novelty.cells, opts.fastestCells) > dedupe) continue;
    if (kept.some((k) => cellOverlap(k.novelty.cells, c.novelty.cells) > dedupe)) continue;
    kept.push(c);
    if (kept.length >= limit) break;
  }
  return kept;
}

export interface RoundTripRankOptions {
  targetS: number;
  tolerance?: number;
  limit?: number;
  dedupeOverlap?: number;
}

export function rankRoundTripCandidates<T>(
  candidates: ReadonlyArray<{ candidate: T; durationS: number; novelty: RouteNovelty }>,
  opts: RoundTripRankOptions,
): ScoredCandidate<T>[] {
  const tol = opts.tolerance ?? 0.15;
  const limit = opts.limit ?? 3;
  const dedupe = opts.dedupeOverlap ?? 0.8;
  const scored = candidates
    .filter((c) => Math.abs(c.durationS - opts.targetS) <= opts.targetS * tol)
    .map((c) => {
      const timeFit = Math.abs(c.durationS - opts.targetS) / opts.targetS;
      const score =
        c.novelty.newKm * (1 - c.novelty.retraceRatio) +
        0.1 * c.novelty.totalKm * (1 - c.novelty.retraceRatio) -
        timeFit * c.novelty.totalKm * 0.5;
      return { ...c, score };
    })
    .sort((x, y) => y.score - x.score);
  const kept: ScoredCandidate<T>[] = [];
  for (const c of scored) {
    if (kept.some((k) => cellOverlap(k.novelty.cells, c.novelty.cells) > dedupe)) continue;
    kept.push(c);
    if (kept.length >= limit) break;
  }
  return kept;
}

export interface AreaStat {
  /** AREA_RES cell */
  cell: Cell;
  /** 0–1 share of the area's VISIT_RES cells not yet visited */
  unvisitedFraction: number;
}

/**
 * Choose area centres to route through for an explore A→B route: inside the reachable
 * ellipse, not hugging either endpoint, well separated, most unexplored first.
 */
export function pickExploreViaPoints(
  areas: readonly AreaStat[],
  from: LngLat,
  to: LngLat,
  maxSumM: number,
  count = 4,
): LngLat[] {
  const direct = haversineM(from, to);
  const minEndGapM = Math.max(300, direct * 0.1);
  const minSeparationM = Math.max(500, (maxSumM - direct) * 0.25);
  const ranked = areas
    .filter((a) => a.unvisitedFraction >= 0.3)
    .map((a) => ({ ...a, center: cellCenter(a.cell) }))
    // Keep a margin inside the ellipse: roads are longer than straight lines.
    .filter((a) => inEllipse(a.center, from, to, direct + (maxSumM - direct) * 0.7))
    .filter((a) => haversineM(a.center, from) > minEndGapM && haversineM(a.center, to) > minEndGapM)
    .sort((x, y) => y.unvisitedFraction - x.unvisitedFraction);
  const picked: LngLat[] = [];
  for (const a of ranked) {
    if (picked.every((p) => haversineM(p, a.center) >= minSeparationM)) picked.push(a.center);
    if (picked.length >= count) break;
  }
  return picked;
}

/** Radius of the circle a round trip of the given road distance should follow. */
export function roundTripRadiusM(targetDistanceM: number): number {
  return (targetDistanceM / (2 * Math.PI)) * 0.8;
}

/**
 * Via points for a loop leaving start on `bearing`: the loop is a circle through start whose
 * centre lies `radius` away on that bearing; via points sit at ±120° around that circle.
 */
export function roundTripViaPoints(start: LngLat, bearing: number, radiusM: number): LngLat[] {
  const centre = destination(start, bearing, radiusM);
  const back = (bearing + 180) % 360;
  return [
    destination(centre, (back + 120) % 360, radiusM),
    destination(centre, (back + 240) % 360, radiusM),
  ];
}

/**
 * Rank loop directions (every 30°) by how unexplored the areas near the loop centre are,
 * returning up to `count` bearings.
 */
export function roundTripBearings(
  start: LngLat,
  radiusM: number,
  unexploredAt: (p: LngLat) => number,
  count = 6,
): number[] {
  const options = Array.from({ length: 12 }, (_, i) => i * 30).map((b) => ({
    bearing: b,
    score: unexploredAt(destination(start, b, radiusM)),
  }));
  options.sort((x, y) => y.score - x.score || x.bearing - y.bearing);
  const chosen: number[] = [];
  for (const o of options) {
    if (chosen.every((c) => Math.abs(((o.bearing - c + 540) % 360) - 180) >= 45)) {
      chosen.push(o.bearing);
    }
    if (chosen.length >= count) break;
  }
  // Pad with remaining directions if the spacing rule left us short.
  for (const o of options) {
    if (chosen.length >= count) break;
    if (!chosen.includes(o.bearing)) chosen.push(o.bearing);
  }
  return chosen;
}
