import {
  type LngLat,
  destination,
  haversineM,
  inEllipse,
  lineLengthM,
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
  /** OSM ways the route uses, when the routing engine reported them. */
  wayIds?: number[];
}

/** A stretch of one OSM way: [first point, last point, way id], as GraphHopper reports them. */
export type WayRun = readonly [number, number, number];

/**
 * How much of a route runs along roads the user has never travelled, measured by road rather
 * than by hexagon. Falls back to nothing when the engine reported no way ids.
 */
export function routeNoveltyByWays(
  coords: readonly LngLat[],
  runs: readonly WayRun[],
  isVisitedWay: (wayId: number) => boolean,
  cellNovelty: RouteNovelty,
): RouteNovelty {
  if (runs.length === 0) return cellNovelty;
  let total = 0;
  let fresh = 0;
  let retraced = 0;
  const seen = new Set<number>();
  const order: number[] = [];
  for (const [from, to, wayId] of runs) {
    const piece = coords.slice(from, to + 1);
    if (piece.length < 2) continue;
    const length = lineLengthM(piece);
    total += length;
    if (!isVisitedWay(wayId)) fresh += length;
    if (seen.has(wayId)) retraced += length;
    else {
      seen.add(wayId);
      order.push(wayId);
    }
  }
  if (total === 0) return cellNovelty;
  return {
    newKm: fresh / 1000,
    totalKm: total / 1000,
    noveltyPct: Math.round((fresh / total) * 1000) / 10,
    retraceRatio: retraced / total,
    // Cells still drive candidate de-duplication and the routing bias.
    cells: cellNovelty.cells,
    wayIds: order,
  };
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
  /** Candidates asking for more U-turns than this are not offered at all. */
  maxUTurns?: number;
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
  const maxUTurns = opts.maxUTurns ?? 1;
  const scored = candidates
    .filter((c) => c.durationS <= maxS && c.novelty.newKm > 0 && (c.uTurns ?? 0) <= maxUTurns)
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
  /** Score penalty in km for each U-turn the loop asks for. */
  kmPenaltyPerUTurn?: number;
  /** Loops asking for more U-turns than this are not offered at all. */
  maxUTurns?: number;
}

export function rankRoundTripCandidates<T>(
  candidates: ReadonlyArray<{ candidate: T; durationS: number; novelty: RouteNovelty; uTurns?: number }>,
  opts: RoundTripRankOptions,
): ScoredCandidate<T>[] {
  const tol = opts.tolerance ?? 0.15;
  const limit = opts.limit ?? 3;
  const dedupe = opts.dedupeOverlap ?? 0.8;
  const uTurnPenalty = opts.kmPenaltyPerUTurn ?? 8;
  const maxUTurns = opts.maxUTurns ?? 1;
  const scored = candidates
    .filter((c) => Math.abs(c.durationS - opts.targetS) <= opts.targetS * tol && (c.uTurns ?? 0) <= maxUTurns)
    .map((c) => {
      const timeFit = Math.abs(c.durationS - opts.targetS) / opts.targetS;
      const score =
        c.novelty.newKm * (1 - c.novelty.retraceRatio) +
        0.1 * c.novelty.totalKm * (1 - c.novelty.retraceRatio) -
        timeFit * c.novelty.totalKm * 0.5 -
        uTurnPenalty * (c.uTurns ?? 0);
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

/**
 * Via points to ask again with, for a route that turns around at one of its vias.
 *
 * Via points sit on mapped streets, often at a road node or down a dead end. There the router
 * can only reach the via and leave it the way it came, so the route dips off the main road, makes
 * a U-turn at the via and comes straight back out. Each such via is moved to the middle of the
 * stretch of road the route was on just before it turned off. The route already drives through
 * that stretch, and a point part-way along a road (not at a node) is somewhere the router can
 * carry straight on through.
 *
 * `uTurnAt` holds the route-geometry index of each U-turn. Returns null when no U-turn is at a
 * via, so there is nothing to ask again.
 */
export function viasAvoidingTurnarounds(
  coords: readonly LngLat[],
  uTurnAt: readonly number[],
  vias: readonly LngLat[],
  toleranceM = 5,
): LngLat[] | null {
  const same = (a: LngLat, b: LngLat) => haversineM(a, b) < 3;
  const out = [...vias];
  let moved = false;
  for (const i of uTurnAt) {
    const at = coords[i];
    if (!at) continue;
    const v = vias.findIndex((p) => haversineM(p, at) <= toleranceM);
    if (v < 0) continue;
    // Where two legs meet, the via can appear twice in a row.
    let a = i;
    let b = i;
    while (a > 0 && same(coords[a - 1]!, at)) a--;
    while (b < coords.length - 1 && same(coords[b + 1]!, at)) b++;
    // Walk out along the dip while the way in and the way back out match.
    while (a > 0 && b < coords.length - 1 && same(coords[a - 1]!, coords[b + 1]!)) {
      a--;
      b++;
    }
    // a is now where the route turned off; the route must have been somewhere before it.
    if (a < 1) continue;
    const [p, q] = [coords[a - 1]!, coords[a]!];
    out[v] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    moved = true;
  }
  return moved ? out : null;
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
