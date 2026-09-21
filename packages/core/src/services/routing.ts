import { randomUUID } from 'node:crypto';
import {
  AREA_RES,
  DEFAULT_EXPLORE_BUDGET_MIN,
  type DiscoverItem,
  type ExploreRouteResponse,
  type LngLat,
  type Mode,
  type PoiCategory,
  type Route,
  type RouteNovelty,
  TYPICAL_SPEED_MPS,
  bboxOf,
  bboxToCells,
  bigIntToCell,
  cellToBigInt,
  haversineM,
  pickExploreViaPoints,
  pointInRing,
  pointToCell,
  polygonCells,
  rankExploreCandidates,
  rankRoundTripCandidates,
  roundTripBearings,
  roundTripRadiusM,
  roundTripViaPoints,
  routeNovelty,
  visitedAreaPolygon,
} from '@wayfinder/shared';
import { gridDisk } from 'h3-js';
import type { DbClient } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import type { CustomModel, GhPath, GraphHopperClient } from '../lib/graphhopper.js';
import type { MetricsAggregator } from '../lib/metrics.js';
import { areaUnexplored, loadVisitedCells } from './coverage.js';

export interface RoutingDeps {
  db: DbClient;
  graphhopper: GraphHopperClient;
  metrics: MetricsAggregator;
}

export const profileFor = (mode: Mode) => mode;

export function toRoute(
  path: GhPath,
  opts: { kind: Route['kind']; mode: Mode; novelty: RouteNovelty; extraDurationS: number; viaPoints: LngLat[] },
): Route {
  return {
    id: randomUUID(),
    kind: opts.kind,
    mode: opts.mode,
    distanceM: path.distance,
    durationS: path.time / 1000,
    extraDurationS: Math.max(0, opts.extraDurationS),
    geometry: path.points.coordinates.map(([lon, lat]) => [lon, lat] as LngLat),
    instructions: path.instructions.map((i) => ({
      sign: i.sign,
      text: i.text,
      streetName: i.street_name ?? '',
      distanceM: i.distance,
      durationS: i.time / 1000,
      interval: i.interval,
      ...(i.exit_number !== undefined ? { exitNumber: i.exit_number } : {}),
    })),
    viaPoints: opts.viaPoints,
    novelty: {
      totalKm: Math.round(opts.novelty.totalKm * 100) / 100,
      newKm: Math.round(opts.novelty.newKm * 100) / 100,
      noveltyPct: Math.round(opts.novelty.noveltyPct * 10) / 10,
    },
  };
}

function visitedModel(polygon: NonNullable<ReturnType<typeof visitedAreaPolygon>>, factor: number): CustomModel {
  return {
    priority: [{ if: 'in_visited', multiply_by: factor }],
    areas: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'visited', properties: {}, geometry: polygon }],
    },
  };
}

async function recordRequest(db: DbClient, userId: string, kind: string, mode: Mode) {
  await db.query('INSERT INTO route_requests (user_id, kind, mode) VALUES ($1, $2, $3)', [userId, kind, mode]);
}

async function visitedSetFor(db: DbClient, userId: string, coords: LngLat[], padM: number) {
  const cells = await loadVisitedCells(db, userId, bboxOf(coords, padM));
  return { cells, set: new Set(cells) };
}

interface Candidate {
  path: GhPath;
  vias: LngLat[];
}

/** Run route requests concurrently, ignoring individual failures (e.g. unreachable via). */
async function tryRoutes(
  deps: RoutingDeps,
  requests: Array<{ points: LngLat[]; mode: Mode; customModel?: CustomModel; alternatives?: number; vias: LngLat[] }>,
  label: string,
): Promise<Candidate[]> {
  const results = await Promise.allSettled(
    requests.map((r) =>
      deps.metrics.time('graphhopper.route', label, () =>
        deps.graphhopper.route({
          points: r.points,
          profile: profileFor(r.mode),
          ...(r.customModel ? { customModel: r.customModel } : {}),
          ...(r.alternatives ? { alternatives: r.alternatives } : {}),
        }),
      ),
    ),
  );
  const out: Candidate[] = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') for (const path of res.value) out.push({ path, vias: requests[i]!.vias });
  });
  return out;
}

export async function fastestRoute(
  deps: RoutingDeps,
  userId: string,
  req: { from: LngLat; to: LngLat; mode: Mode; via: LngLat[] },
): Promise<Route> {
  const points = [req.from, ...req.via, req.to];
  const [path] = await deps.metrics.time('graphhopper.route', 'fastest', () =>
    deps.graphhopper.route({ points, profile: profileFor(req.mode) }),
  );
  if (!path) throw new AppError(422, 'no_route', 'No route found');
  const { set } = await visitedSetFor(deps.db, userId, path.points.coordinates, 500);
  await recordRequest(deps.db, userId, 'fastest', req.mode);
  return toRoute(path, {
    kind: 'fastest',
    mode: req.mode,
    novelty: routeNovelty(path.points.coordinates, (c) => set.has(c)),
    extraDurationS: 0,
    viaPoints: req.via,
  });
}

export async function exploreRoutes(
  deps: RoutingDeps,
  userId: string,
  req: { from: LngLat; to: LngLat; mode: Mode; budgetMin: number | undefined },
): Promise<ExploreRouteResponse> {
  const budgetS = (req.budgetMin ?? DEFAULT_EXPLORE_BUDGET_MIN[req.mode]) * 60;
  const [fastestPath] = await deps.metrics.time('graphhopper.route', 'explore.fastest', () =>
    deps.graphhopper.route({ points: [req.from, req.to], profile: profileFor(req.mode) }),
  );
  if (!fastestPath) throw new AppError(422, 'no_route', 'No route found');
  const t0 = fastestPath.time / 1000;
  const direct = haversineM(req.from, req.to);
  // Straight-line budget for detours: scale the fastest road distance by the allowed time.
  const maxSumM = Math.max(direct * 1.05, fastestPath.distance * ((t0 + budgetS) / Math.max(t0, 1)));
  const padM = Math.max(500, (maxSumM - direct) / 2);
  const corridor = [req.from, req.to, ...fastestPath.points.coordinates];
  const { cells: visitedCells, set } = await visitedSetFor(deps.db, userId, corridor, padM);
  const isVisited = (c: string) => set.has(c);
  const fastestNovelty = routeNovelty(fastestPath.points.coordinates, isVisited);

  const polygon = visitedAreaPolygon(visitedCells, 3000);
  const areaCells = bboxToCells(bboxOf(corridor, padM), AREA_RES);
  const [unexplored, hasRoads] = await Promise.all([areaUnexplored(deps.db, userId, areaCells), cellsWithRoads(deps.db, areaCells)]);
  const picked = pickExploreViaPoints(
    [...unexplored].filter(([cell]) => hasRoads(cell)).map(([cell, unvisitedFraction]) => ({ cell, unvisitedFraction })),
    req.from,
    req.to,
    maxSumM,
    3,
  );
  const vias = (await snapToRoads(deps.db, picked)).filter((v): v is LngLat => v !== null);

  const requests: Parameters<typeof tryRoutes>[1] = [
    { points: [req.from, req.to], mode: req.mode, alternatives: 3, vias: [] },
  ];
  if (polygon) {
    for (const factor of [0.5, 0.2]) {
      requests.push({ points: [req.from, req.to], mode: req.mode, customModel: visitedModel(polygon, factor), vias: [] });
    }
  }
  const viaModel = polygon ? visitedModel(polygon, 0.5) : undefined;
  for (const via of vias) {
    requests.push({ points: [req.from, via, req.to], mode: req.mode, ...(viaModel ? { customModel: viaModel } : {}), vias: [via] });
  }
  if (vias.length >= 2) {
    // Order the pair along the trip direction.
    const pair = vias.slice(0, 2).sort((a, b) => haversineM(req.from, a) - haversineM(req.from, b));
    requests.push({ points: [req.from, ...pair, req.to], mode: req.mode, ...(viaModel ? { customModel: viaModel } : {}), vias: pair });
  }

  const candidates = await tryRoutes(deps, requests, 'explore.candidate');
  const ranked = rankExploreCandidates(
    candidates
      .map((c) => ({
        candidate: c,
        durationS: c.path.time / 1000,
        novelty: routeNovelty(c.path.points.coordinates, isVisited),
      }))
      // Only keep candidates that actually add new ground over the fastest route.
      .filter((c) => c.novelty.newKm > fastestNovelty.newKm + 0.05),
    { fastestDurationS: t0, fastestCells: fastestNovelty.cells, budgetS, limit: 3 },
  );

  await recordRequest(deps.db, userId, 'explore', req.mode);
  return {
    fastest: toRoute(fastestPath, { kind: 'fastest', mode: req.mode, novelty: fastestNovelty, extraDurationS: 0, viaPoints: [] }),
    explore: ranked.map((r) =>
      toRoute(r.candidate.path, {
        kind: 'explore',
        mode: req.mode,
        novelty: r.novelty,
        extraDurationS: r.durationS - t0,
        viaPoints: r.candidate.vias,
      }),
    ),
  };
}

export async function roundTrips(
  deps: RoutingDeps,
  userId: string,
  req: { start: LngLat; mode: Mode; targetMin: number },
): Promise<Route[]> {
  const targetS = req.targetMin * 60;
  let radius = roundTripRadiusM(targetS * TYPICAL_SPEED_MPS[req.mode]);
  const { cells: visitedCells, set } = await visitedSetFor(deps.db, userId, [req.start], radius * 2.5);
  const isVisited = (c: string) => set.has(c);
  const polygon = visitedAreaPolygon(visitedCells, 3000);
  const model = polygon ? visitedModel(polygon, 0.5) : undefined;
  const areaCells = bboxToCells(bboxOf([req.start], radius * 2.5), AREA_RES);
  const [unexplored, hasRoads] = await Promise.all([areaUnexplored(deps.db, userId, areaCells), cellsWithRoads(deps.db, areaCells)]);
  // Directions with no roads (out to sea) rank last, however "unexplored" they are.
  const unexploredAt = (p: LngLat) => {
    const cell = pointToCell(p, AREA_RES);
    return hasRoads(cell) ? (unexplored.get(cell) ?? 1) : 0;
  };

  const loopRequests = async (bearings: number[], r: number) => {
    const loops = bearings.map((b) => roundTripViaPoints(req.start, b, r));
    const snapped = await snapToRoads(deps.db, loops.flat());
    return loops.flatMap((loop, i) => {
      const vias = snapped.slice(i * loop.length, (i + 1) * loop.length);
      // A loop whose turning points can't reach a road is dropped rather than failing in the router.
      if (vias.some((v) => v === null)) return [];
      const onRoads = vias as LngLat[];
      return [{ points: [req.start, ...onRoads, req.start], mode: req.mode, ...(model ? { customModel: model } : {}), vias: onRoads }];
    });
  };

  // Pass 1: calibrate the radius against real road durations.
  const probeBearings = roundTripBearings(req.start, radius, unexploredAt, 2);
  const probe = await tryRoutes(deps, await loopRequests(probeBearings, radius), 'roundtrip.probe');
  if (probe.length > 0) {
    const ratios = probe.map((c) => c.path.time / 1000 / targetS).sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)]!;
    if (median > 0.05) radius = radius / median;
  }
  const bearings = roundTripBearings(req.start, radius, unexploredAt, 6);
  const candidates = [...probe, ...(await tryRoutes(deps, await loopRequests(bearings, radius), 'roundtrip.candidate'))];

  const ranked = rankRoundTripCandidates(
    candidates.map((c) => ({
      candidate: c,
      durationS: c.path.time / 1000,
      novelty: routeNovelty(c.path.points.coordinates, isVisited),
    })),
    { targetS, tolerance: 0.2, limit: 3 },
  );
  await recordRequest(deps.db, userId, 'roundtrip', req.mode);
  return ranked.map((r) =>
    toRoute(r.candidate.path, {
      kind: 'roundtrip',
      mode: req.mode,
      novelty: r.novelty,
      extraDurationS: 0,
      viaPoints: r.candidate.vias,
    }),
  );
}

/**
 * Area cells with mapped streets or addresses. Via points must be somewhere a road reaches: the
 * least-explored cells near a coastal city are mostly sea, which the router can't route to.
 * With no place data at all (not imported yet) every cell is kept, as before.
 */
async function cellsWithRoads(db: DbClient, cells: readonly string[]): Promise<(cell: string) => boolean> {
  if (cells.length === 0) return () => true;
  const r = await db.query<{ c: string }>(
    `SELECT c::text FROM unnest($1::bigint[]) AS c
     WHERE EXISTS (SELECT 1 FROM places WHERE r7 = c AND kind IN ('street', 'address'))`,
    [cells.map((c) => cellToBigInt(c).toString())],
  );
  if (r.rows.length === 0) {
    const any = await db.query('SELECT 1 FROM places LIMIT 1');
    if (any.rows.length === 0) return () => true;
  }
  const roads = new Set(r.rows.map((x) => bigIntToCell(x.c)));
  return (cell) => roads.has(cell);
}

/**
 * Move each via point onto the nearest mapped street within maxM, or null if there is none (open
 * sea, empty bush). With no place data at all, points are returned unchanged.
 */
async function snapToRoads(db: DbClient, points: readonly LngLat[], maxM = 3000): Promise<(LngLat | null)[]> {
  if (points.length === 0) return [];
  const r = await db.query<{ i: string; lon: number; lat: number }>(
    `SELECT p.i::text, s.lon, s.lat
     FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS p(lon, lat, i)
     CROSS JOIN LATERAL (
       SELECT lon, lat FROM places WHERE kind = 'street'
       ORDER BY point(lon, lat) <-> point(p.lon, p.lat) LIMIT 1
     ) s`,
    [points.map((p) => p[0]), points.map((p) => p[1])],
  );
  if (r.rows.length === 0) return points.map((p) => p);
  const snapped = new Map(r.rows.map((x) => [Number(x.i) - 1, [x.lon, x.lat] as LngLat]));
  return points.map((p, i) => {
    const s = snapped.get(i);
    return s && haversineM(p, s) <= maxM ? s : null;
  });
}

const CATEGORY_WEIGHT: Record<PoiCategory, number> = {
  viewpoint: 1,
  peak: 1,
  waterfall: 1,
  beach: 0.9,
  trailhead: 0.9,
  attraction: 0.85,
  historic: 0.8,
  park: 0.75,
  museum: 0.7,
  picnic: 0.6,
  cafe: 0.5,
};

export async function discover(
  deps: RoutingDeps,
  userId: string,
  q: { lon: number; lat: number; mode: Mode; maxMinutes: number; categories?: PoiCategory[] | undefined; limit: number },
): Promise<DiscoverItem[]> {
  const origin: LngLat = [q.lon, q.lat];
  const rings = await deps.metrics.time('graphhopper.isochrone', q.mode, () =>
    deps.graphhopper.isochrone(origin, profileFor(q.mode), q.maxMinutes * 60),
  );
  const areaCells = new Set<string>();
  for (const ring of rings) {
    for (const c of polygonCells(ring, AREA_RES)) for (const n of gridDisk(c, 1)) areaCells.add(n);
  }
  areaCells.add(pointToCell(origin, AREA_RES));
  const places = (
    await deps.db.query<{ id: string; name: string; category: PoiCategory; lon: number; lat: number; r9: string; r7: string }>(
      `SELECT id, name, category, lon, lat, r9, r7 FROM places
       WHERE category IS NOT NULL AND r7 = ANY($1::bigint[]) AND ($2::text[] IS NULL OR category = ANY($2::text[]))
       LIMIT 20000`,
      [[...areaCells].map((c) => cellToBigInt(c).toString()), q.categories ?? null],
    )
  ).rows.filter((p) => rings.some((ring) => pointInRing([p.lon, p.lat], ring)));
  if (places.length === 0) return [];

  const visited = new Set(
    (
      await deps.db.query<{ cell: string }>(
        'SELECT cell FROM visited_cells WHERE user_id = $1 AND cell = ANY($2::bigint[])',
        [userId, places.map((p) => p.r9)],
      )
    ).rows.map((r) => r.cell),
  );
  const fresh = places.filter((p) => !visited.has(p.r9));
  const unexplored = await areaUnexplored(deps.db, userId, [...new Set(fresh.map((p) => bigIntToCell(p.r7)))]);
  const reachM = q.maxMinutes * 60 * TYPICAL_SPEED_MPS[q.mode];

  const scored = fresh
    .map((p) => {
      const distanceM = haversineM(origin, [p.lon, p.lat]);
      const areaFrac = unexplored.get(bigIntToCell(p.r7)) ?? 1;
      const score = CATEGORY_WEIGHT[p.category] * (0.3 + 0.7 * areaFrac) * Math.exp(-distanceM / Math.max(reachM, 1));
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        location: [p.lon, p.lat] as LngLat,
        distanceM: Math.round(distanceM),
        areaUnexploredPct: Math.round(areaFrac * 100),
        score: Math.round(score * 1000) / 1000,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Drop same-named places close together (e.g. a park mapped as several nodes).
  const out: DiscoverItem[] = [];
  for (const item of scored) {
    if (out.some((o) => o.name === item.name && haversineM(o.location, item.location) < 300)) continue;
    out.push(item);
    if (out.length >= q.limit) break;
  }
  await recordRequest(deps.db, userId, 'discover', q.mode);
  return out;
}
