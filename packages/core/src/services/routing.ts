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
  destination,
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
  routeNoveltyByWays,
  speedLimitRuns,
  viasAvoidingTurnarounds,
  visitedAreaPolygon,
} from '@wayfinder/shared';
import { gridDisk } from 'h3-js';
import type { DbClient } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import type { CustomModel, GhInstruction, GhPath, GraphHopperClient } from '../lib/graphhopper.js';
import type { MetricsAggregator } from '../lib/metrics.js';
import { areaUnexplored, loadVisitedCells } from './coverage.js';
import { finishRoutes } from './road-facts.js';
import { visitedWayIds } from './roads.js';

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
    instructions: joinSplitRoundabouts(path.instructions).map((i) => ({
      sign: i.sign,
      text: i.text,
      streetName: i.street_name ?? '',
      distanceM: i.distance,
      durationS: i.time / 1000,
      interval: i.interval,
      ...(i.exit_number !== undefined ? { exitNumber: i.exit_number } : {}),
      ...exitAngleOf(i),
    })),
    viaPoints: opts.viaPoints,
    speedLimits: speedLimitRuns(path.points.coordinates, path.details?.max_speed ?? []),
    novelty: {
      totalKm: Math.round(opts.novelty.totalKm * 100) / 100,
      newKm: Math.round(opts.novelty.newKm * 100) / 100,
      noveltyPct: Math.round(opts.novelty.noveltyPct * 10) / 10,
    },
  };
}

const ROUNDABOUT = 6;
const VIA_REACHED = 5;

/** GraphHopper's turn_angle (radians round the roundabout) as degrees, where it gave a usable one. */
function exitAngleOf(i: GhInstruction): { exitAngleDeg?: number } {
  const a = i.turn_angle;
  if (i.sign !== ROUNDABOUT || a === undefined || !Number.isFinite(a)) return {};
  const deg = Math.round((Math.abs(a) * 180) / Math.PI);
  return deg >= 1 && deg <= 360 ? { exitAngleDeg: deg } : {};
}
const roundaboutText = (exit: number, street: string | undefined) => `At roundabout, take exit ${exit}${street ? ` onto ${street}` : ''}`;

/**
 * A stop on a detour or loop can land on a roundabout. GraphHopper then splits it in two: "Enter
 * roundabout" with the exits passed before the stop, then "take exit N" counted again from the
 * stop, so going round to come back is announced as the first exit (a left turn). Put the two
 * halves back together as the one exit the driver takes.
 */
export function joinSplitRoundabouts(instructions: readonly GhInstruction[]): GhInstruction[] {
  const out: GhInstruction[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const enter = instructions[i]!;
    const via = instructions[i + 1];
    const after = instructions[i + 2];
    const split = enter.sign === ROUNDABOUT && enter.exited === false && via?.sign === VIA_REACHED && after !== undefined;
    if (!split) {
      out.push(enter);
      continue;
    }
    const sameRoundabout = after.sign === ROUNDABOUT;
    // The stop where the roundabout is left: the exit counted on the way in is the one taken.
    const exit = (enter.exit_number ?? 0) + (sameRoundabout ? (after.exit_number ?? 0) : 0);
    const parts = sameRoundabout ? [enter, via, after] : [enter, via];
    // Each half has the angle of its own part of the roundabout; the exit is where the two end.
    // Without the second half there is only half the angle, which would draw the wrong exit.
    const { turn_angle: _partial, ...entered } = enter;
    const angle = sameRoundabout && enter.turn_angle !== undefined && after.turn_angle !== undefined ? Math.abs(enter.turn_angle) + Math.abs(after.turn_angle) : undefined;
    out.push({
      ...entered,
      ...(angle !== undefined ? { turn_angle: angle } : {}),
      text: roundaboutText(exit, after.street_name || undefined),
      exit_number: exit,
      exited: true,
      ...(after.street_name ? { street_name: after.street_name } : {}),
      distance: parts.reduce((s, p) => s + p.distance, 0),
      time: parts.reduce((s, p) => s + p.time, 0),
      interval: [enter.interval[0], parts.at(-1)!.interval[1]],
    });
    i += parts.length - 1;
  }
  return out;
}

/**
 * Detours should stay on roads people are happy to drive: tracks are nearly excluded and service
 * roads (car parks, driveways, laneways) discouraged. Walking keeps them: paths are the point.
 */
const EASIER_DRIVING = [
  { if: 'road_class == TRACK', multiply_by: 0.05 },
  { if: 'road_class == SERVICE', multiply_by: 0.3 },
];

/** Custom model for explore candidates: easier roads for cars, away from places already visited. */
function exploreModel(mode: Mode, polygon: ReturnType<typeof visitedAreaPolygon> | null, factor: number): CustomModel | undefined {
  const priority = [...(mode === 'car' ? EASIER_DRIVING : []), ...(polygon ? [{ if: 'in_visited', multiply_by: factor }] : [])];
  if (priority.length === 0) return undefined;
  return {
    priority,
    ...(polygon
      ? { areas: { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, id: 'visited', properties: {}, geometry: polygon }] } }
      : {}),
  };
}

/** Where the route turns the driver around; GraphHopper signs: -98 unknown, ±8 left/right. */
const uTurnsIn = (path: GhPath) => (path.instructions ?? []).filter((i) => i.sign === -98 || Math.abs(i.sign) === 8).map((i) => i.interval[0]);

/**
 * U-turns a route may ask for. In Australia they are illegal at traffic lights and wherever
 * signed, so a driving detour that needs one is not offered. On foot, turning round is fine.
 */
const MAX_UTURNS: Record<Mode, number> = { car: 0, foot: 1 };

async function recordRequest(db: DbClient, userId: string, kind: string, mode: Mode) {
  await db.query('INSERT INTO route_requests (user_id, kind, mode) VALUES ($1, $2, $3)', [userId, kind, mode]);
}

async function visitedSetFor(db: DbClient, userId: string, coords: LngLat[], padM: number) {
  const bbox = bboxOf(coords, padM);
  const [cells, ways] = await Promise.all([loadVisitedCells(db, userId, bbox), visitedWayIds(db, userId, bbox)]);
  return { cells, set: new Set(cells), ways };
}

/**
 * How new a route is, measured by the roads it uses. Cells are the fallback where the routing
 * engine reported no way ids (an older graph), and still drive candidate de-duplication.
 */
function noveltyOf(path: GhPath, isVisited: (c: string) => boolean, visitedWays: ReadonlySet<number>) {
  return routeNoveltyByWays(
    path.points.coordinates,
    path.details?.osm_way_id ?? [],
    (wayId) => visitedWays.has(wayId),
    routeNovelty(path.points.coordinates, isVisited),
  );
}

interface Candidate {
  path: GhPath;
  uTurns: number;
  vias: LngLat[];
}

interface RouteRequest {
  points: LngLat[];
  mode: Mode;
  customModel?: CustomModel;
  alternatives?: number;
  vias: LngLat[];
}

/** Run route requests concurrently; a request that fails (e.g. unreachable via) gives no paths. */
async function runRoutes(deps: RoutingDeps, requests: readonly RouteRequest[], label: string): Promise<GhPath[][]> {
  const results = await Promise.allSettled(
    requests.map((r) =>
      deps.metrics.time('graphhopper.route', label, () =>
        deps.graphhopper.route({
          points: r.points,
          profile: profileFor(r.mode),
          ...(r.customModel ? { customModel: r.customModel } : {}),
          ...(r.alternatives ? { alternatives: r.alternatives } : {}),
          // Detours should carry on through their waypoints, not turn around at them.
          ...(r.vias.length > 0 ? { passThrough: true } : {}),
        }),
      ),
    ),
  );
  return results.map((res) => (res.status === 'fulfilled' ? res.value : []));
}

/** Rounds of asking again, with vias moved, for routes that turn around at a via. */
const TURNAROUND_RETRIES = 2;

/**
 * Candidate routes for the requests. A detour that turns around at one of its vias (a dead end,
 * or a via the router can only leave the way it came) is asked for again with that via moved
 * onto the road it turned off, and the new route replaces it if it asks for fewer U-turns.
 */
async function tryRoutes(deps: RoutingDeps, requests: readonly RouteRequest[], label: string): Promise<Candidate[]> {
  const found = (await runRoutes(deps, requests, label)).flatMap((paths, i) =>
    paths.map((path) => ({ path, uTurns: uTurnsIn(path), request: requests[i]! })),
  );
  for (let round = 0; round < TURNAROUND_RETRIES; round++) {
    const retries: Array<{ slot: number; request: RouteRequest }> = [];
    found.forEach((f, slot) => {
      if (f.uTurns.length === 0 || f.request.vias.length === 0) return;
      const snapped = f.path.snapped_waypoints?.coordinates.slice(1, -1);
      const vias = viasAvoidingTurnarounds(
        f.path.points.coordinates,
        f.uTurns,
        snapped && snapped.length === f.request.vias.length ? snapped : f.request.vias,
      );
      if (!vias) return;
      retries.push({ slot, request: { ...f.request, points: [f.request.points[0]!, ...vias, f.request.points.at(-1)!], vias } });
    });
    if (retries.length === 0) break;
    const again = await runRoutes(deps, retries.map((r) => r.request), label);
    retries.forEach(({ slot, request }, i) => {
      const path = again[i]?.[0];
      if (!path) return;
      const uTurns = uTurnsIn(path);
      if (uTurns.length < found[slot]!.uTurns.length) found[slot] = { path, uTurns, request };
    });
  }
  return found.map((f) => ({ path: f.path, uTurns: f.uTurns.length, vias: f.request.vias }));
}

export async function fastestRoute(
  deps: RoutingDeps,
  userId: string,
  req: { from: LngLat; to: LngLat; mode: Mode; via: LngLat[]; heading?: number | undefined; speedMps?: number | undefined },
): Promise<Route> {
  const points = [req.from, ...req.via, req.to];
  const [first] = await deps.metrics.time('graphhopper.route', 'fastest', () =>
    deps.graphhopper.route({ points, profile: profileFor(req.mode), ...(req.heading !== undefined ? { heading: req.heading } : {}) }),
  );
  if (!first) throw new AppError(422, 'no_route', 'No route found');
  const path = (await routePastTurnTooClose(deps, req, first)) ?? first;
  const { set, ways } = await visitedSetFor(deps.db, userId, path.points.coordinates, 500);
  await recordRequest(deps.db, userId, 'fastest', req.mode);
  const make = (p: GhPath) => ({
    route: toRoute(p, { kind: 'fastest', mode: req.mode, novelty: noveltyOf(p, (c) => set.has(c), ways), extraDurationS: 0, viaPoints: req.via }),
    path: p,
  });
  let [route] = await finishRoutes(deps.db, [make(path)]);
  if (route!.usuallySlow && req.mode === 'car' && req.via.length === 0 && req.heading === undefined) {
    route = await quickestOfAlternatives(deps, req.from, req.to, route!, make);
  }
  return req.heading !== undefined ? turnAroundWhenYouCan(route!) : route!;
}

/** How far ahead the lookup routes: enough for the same road's signs to stand in for an unsigned stretch. */
const LIMIT_LOOKAHEAD_M = 400;
/** Further than this from the nearest road, the car isn't on one (a car park, a driveway). */
const ON_ROAD_M = 40;
const NO_LIMIT = { kmh: null, estimated: false, road: null } as const;

/**
 * The limit on the road where a car is, for its map with no trip. GraphHopper has no lookup for one
 * point, so this asks for a short route ahead the way the car is going and finishes it as any route
 * is (signs, school zones in force, electronic signs, main-road estimates), then reads the start.
 */
export async function speedLimitAt(
  deps: RoutingDeps,
  q: { at: LngLat; heading?: number | undefined },
): Promise<{ kmh: number | null; estimated: boolean; road: string | null }> {
  const ahead = destination(q.at, q.heading ?? 0, LIMIT_LOOKAHEAD_M);
  const [path] = await deps.metrics
    .time('graphhopper.route', 'speedLimit', () =>
      deps.graphhopper.route({ points: [q.at, ahead], profile: profileFor('car'), ...(q.heading !== undefined ? { heading: q.heading } : {}) }),
    )
    .catch(() => []);
  const start = path?.points.coordinates[0];
  if (!path || !start || haversineM(q.at, [start[0], start[1]]) > ON_ROAD_M) return NO_LIMIT;
  const novelty = { totalKm: 0, newKm: 0, noveltyPct: 0 } as RouteNovelty;
  const [route] = await finishRoutes(deps.db, [{ route: toRoute(path, { kind: 'fastest', mode: 'car', novelty, extraDurationS: 0, viaPoints: [] }), path }]);
  const at0 = (runs: Route['speedLimits']) => runs?.find((r) => r.from === 0 && r.to > 0);
  const signed = at0(route!.speedLimits);
  const guessed = signed ? undefined : at0(route!.estimatedSpeedLimits);
  return { kmh: signed?.kmh ?? guessed?.kmh ?? null, estimated: !signed && !!guessed, road: path.instructions[0]?.street_name || null };
}

/** Below this a car can still make a turn just ahead. */
const TURN_NEEDS_SPEED_MPS = 5;
/** A turn closer than this much driving can't be made: the answer has to arrive, be heard and be acted on. */
const TURN_NEEDS_S = 6;
/** GraphHopper's signs for leaving the road: slight, plain and sharp, left and right. */
const LEAVES_THE_ROAD = new Set([-3, -2, -1, 1, 2, 3]);

/**
 * A car at speed that asks for a new route can be told to turn into a side street 10 m on, which it
 * has passed by the time the answer comes, and so it's off route again. The heading only stops the
 * route turning it round. So when the first turn is too close, ask again through a point further up
 * the road. Null when there's no better answer: the point may have landed on another road.
 */
async function routePastTurnTooClose(
  deps: RoutingDeps,
  req: { from: LngLat; to: LngLat; mode: Mode; via: LngLat[]; heading?: number | undefined; speedMps?: number | undefined },
  path: GhPath,
): Promise<GhPath | null> {
  const { heading, speedMps } = req;
  if (heading === undefined || speedMps === undefined || speedMps < TURN_NEEDS_SPEED_MPS) return null;
  const needM = speedMps * TURN_NEEDS_S;
  const [on, next] = path.instructions;
  if (on?.sign !== 0 || next === undefined || !LEAVES_THE_ROAD.has(next.sign) || on.distance >= needM) return null;
  const ahead = destination(req.from, heading, needM);
  const [further] = await deps.metrics
    .time('graphhopper.route', 'fastest.ahead', () =>
      deps.graphhopper.route({ points: [req.from, ahead, ...req.via, req.to], profile: profileFor(req.mode), heading, passThrough: true }),
    )
    .catch(() => []);
  const instructions = further && withoutFirstWaypoint(further.instructions);
  return instructions ? { ...further, instructions } : null;
}

/**
 * The instructions without the stop at the point the route was sent through, the road either side
 * of it being one instruction again. Null if the route turns off before it gets there.
 */
function withoutFirstWaypoint(instructions: readonly GhInstruction[]): GhInstruction[] | null {
  const [on, stop, after, ...rest] = instructions;
  if (on?.sign !== 0 || stop?.sign !== VIA_REACHED || !after) return null;
  if (after.sign !== 0) return [on, after, ...rest];
  return [{ ...on, interval: [on.interval[0], after.interval[1]], distance: on.distance + after.distance, time: on.time + after.time }, ...rest];
}

/**
 * When trips say the fastest route is usually slow at this time, the engine's other ways there may
 * really be quicker: ask for them and keep whichever takes least time by the same measure.
 */
async function quickestOfAlternatives(
  deps: RoutingDeps,
  from: LngLat,
  to: LngLat,
  current: Route,
  make: (p: GhPath) => { route: Route; path: GhPath },
): Promise<Route> {
  const paths = await deps.metrics
    .time('graphhopper.route', 'fastest.alternatives', () => deps.graphhopper.route({ points: [from, to], profile: profileFor(current.mode), alternatives: 3 }))
    .catch(() => [] as GhPath[]);
  const finished = await finishRoutes(deps.db, paths.filter((p) => uTurnsIn(p).length === 0).map(make));
  return finished.reduce((best, r) => (r.durationS < best.durationS ? r : best), current);
}

/** What a new route says when the only sensible way is back the way the car came. */
export const TURN_AROUND_TEXT = 'Turn around when you can';

/**
 * A new route asked for on the move starts the way the car is going wherever it can. When it
 * can't (a dead-end street, say), GraphHopper's first instruction is "Make a U-turn onto …" right
 * where the car is, which reads as "turn round here, now". Say what the driver actually has to do.
 */
export function turnAroundWhenYouCan(route: Route): Route {
  const first = route.instructions[0];
  if (!first || !(first.sign === -98 || Math.abs(first.sign) === 8)) return route;
  return { ...route, instructions: [{ ...first, text: TURN_AROUND_TEXT }, ...route.instructions.slice(1)] };
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
  const { cells: visitedCells, set, ways: visitedWays } = await visitedSetFor(deps.db, userId, corridor, padM);
  const isVisited = (c: string) => set.has(c);
  const fastestNovelty = noveltyOf(fastestPath, isVisited, visitedWays);

  const polygon = visitedAreaPolygon(visitedCells, 3000);
  const areaCells = bboxToCells(bboxOf(corridor, padM), AREA_RES);
  const [unexplored, roads] = await Promise.all([areaUnexplored(deps.db, userId, areaCells), cellsWithRoads(deps.db, areaCells)]);
  const picked = pickExploreViaPoints(
    [...unexplored].filter(([cell]) => roads.has(cell)).map(([cell, unvisitedFraction]) => ({ cell, unvisitedFraction })),
    req.from,
    req.to,
    maxSumM,
    3,
  );
  // Where no through-road is mapped nearby (rural areas), keep the original point: the router
  // rejects it if it really is unreachable, which is better than offering no detour at all.
  const snappedVias = await snapToRoads(deps.db, picked);
  const vias = picked.map((p, i) => snappedVias[i] ?? p);

  const requests: RouteRequest[] = [
    { points: [req.from, req.to], mode: req.mode, alternatives: 3, vias: [] },
  ];
  for (const factor of [0.5, 0.2]) {
    const model = exploreModel(req.mode, polygon, factor);
    if (model) requests.push({ points: [req.from, req.to], mode: req.mode, customModel: model, vias: [] });
  }
  const viaModel = exploreModel(req.mode, polygon, 0.5);
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
        uTurns: c.uTurns,
        novelty: noveltyOf(c.path, isVisited, visitedWays),
      }))
      // Only keep candidates that actually add new ground over the fastest route.
      .filter((c) => c.novelty.newKm > fastestNovelty.newKm + 0.05),
    { fastestDurationS: t0, fastestCells: fastestNovelty.cells, budgetS, limit: 3, maxUTurns: MAX_UTURNS[req.mode] },
  );

  await recordRequest(deps.db, userId, 'explore', req.mode);
  const [fastest, ...explore] = await finishRoutes(deps.db, [
    { route: toRoute(fastestPath, { kind: 'fastest', mode: req.mode, novelty: fastestNovelty, extraDurationS: 0, viaPoints: [] }), path: fastestPath },
    ...ranked.map((r) => ({
      route: toRoute(r.candidate.path, { kind: 'explore', mode: req.mode, novelty: r.novelty, extraDurationS: r.durationS - t0, viaPoints: r.candidate.vias }),
      path: r.candidate.path,
    })),
  ]);
  // Times now allow for lights and what trips have learned, so the extra time is by the same measure.
  return { fastest: fastest!, explore: explore.map((r) => ({ ...r, extraDurationS: Math.max(0, r.durationS - fastest!.durationS) })) };
}

export async function roundTrips(
  deps: RoutingDeps,
  userId: string,
  req: { start: LngLat; mode: Mode; targetMin: number },
): Promise<Route[]> {
  const targetS = req.targetMin * 60;
  let radius = roundTripRadiusM(targetS * TYPICAL_SPEED_MPS[req.mode]);
  const { cells: visitedCells, set, ways: visitedWays } = await visitedSetFor(deps.db, userId, [req.start], radius * 2.5);
  const isVisited = (c: string) => set.has(c);
  const polygon = visitedAreaPolygon(visitedCells, 3000);
  const model = exploreModel(req.mode, polygon, 0.5);
  const areaCells = bboxToCells(bboxOf([req.start], radius * 2.5), AREA_RES);
  const [unexplored, roads] = await Promise.all([areaUnexplored(deps.db, userId, areaCells), cellsWithRoads(deps.db, areaCells)]);
  // Directions with no roads (out to sea) rank last, however "unexplored" they are.
  const unexploredAt = (p: LngLat) => {
    const cell = pointToCell(p, AREA_RES);
    return roads.has(cell) ? (unexplored.get(cell) ?? 1) : 0;
  };

  const loopRequests = async (bearings: number[], r: number) => {
    const loops = bearings.map((b) => roundTripViaPoints(req.start, b, r));
    const flat = loops.flat();
    // Road presence is judged around the turning points themselves: the radius grows during
    // calibration, and a loop can reach well beyond the area looked at for unexplored cells.
    const [snapped, viaRoads] = await Promise.all([
      snapToRoads(deps.db, flat),
      cellsWithRoads(deps.db, [...new Set(flat.map((p) => pointToCell(p, AREA_RES)))]),
    ]);
    return loops.flatMap((loop, i) => {
      // Fall back to the original turning point where roads exist but none is mapped within
      // snapping range (rural). Where the area has roads mapped and this spot has none (the
      // sea), drop the loop instead of asking the router for the impossible.
      const onRoads = loop.map((p, j) => snapped[i * loop.length + j] ?? (viaRoads.has(pointToCell(p, AREA_RES)) ? p : null));
      if (onRoads.some((p) => p === null)) return [];
      const vias = onRoads as LngLat[];
      return [{ points: [req.start, ...vias, req.start], mode: req.mode, ...(model ? { customModel: model } : {}), vias }];
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

  const LOOPS = 3;
  const rank = () =>
    rankRoundTripCandidates(
      candidates.map((c) => ({
        candidate: c,
        durationS: c.path.time / 1000,
        uTurns: c.uTurns,
        novelty: noveltyOf(c.path, isVisited, visitedWays),
      })),
      { targetS, tolerance: 0.2, limit: LOOPS, maxUTurns: MAX_UTURNS[req.mode] },
    );
  let ranked = rank();
  if (req.mode === 'car') {
    // Driving loops that need a U-turn aren't offered, which can leave too few from the
    // directions tried first. Try the rest, then the directions between them, only as needed.
    const tried = new Set([...probeBearings, ...bearings]);
    const byUnexplored = (bs: number[]) => bs.sort((a, b) => unexploredAt(destination(req.start, b, radius)) - unexploredAt(destination(req.start, a, radius)));
    const more = [
      roundTripBearings(req.start, radius, unexploredAt, 12).filter((b) => !tried.has(b)),
      byUnexplored(Array.from({ length: 12 }, (_, i) => i * 30 + 15)),
    ];
    for (const next of more) {
      if (ranked.length >= LOOPS || next.length === 0) break;
      candidates.push(...(await tryRoutes(deps, await loopRequests(next, radius), 'roundtrip.candidate')));
      ranked = rank();
    }
  }
  await recordRequest(deps.db, userId, 'roundtrip', req.mode);
  return finishRoutes(
    deps.db,
    ranked.map((r) => ({
      route: toRoute(r.candidate.path, { kind: 'roundtrip', mode: req.mode, novelty: r.novelty, extraDurationS: 0, viaPoints: r.candidate.vias }),
      path: r.candidate.path,
    })),
  );
}

/**
 * Which area cells have mapped streets or addresses. Via points must be somewhere a road reaches:
 * the least-explored cells near a coastal city are mostly sea, which the router can't route to.
 */
async function cellsWithRoads(db: DbClient, cells: readonly string[]): Promise<{ has: (cell: string) => boolean; covered: boolean }> {
  if (cells.length === 0) return { has: () => true, covered: false };
  const r = await db.query<{ c: string }>(
    `SELECT c::text FROM unnest($1::bigint[]) AS c
     WHERE EXISTS (SELECT 1 FROM places WHERE r7 = c AND kind IN ('street', 'address'))`,
    [cells.map((c) => cellToBigInt(c).toString())],
  );
  const roads = new Set(r.rows.map((x) => bigIntToCell(x.c)));
  // No road data anywhere near here: the map simply doesn't cover this area, so don't conclude
  // that its roads don't exist. Only where some cells do have roads is an empty cell really empty.
  const covered = roads.size > 0;
  return { has: (cell) => !covered || roads.has(cell), covered };
}

/** Road classes a route shouldn't be sent down and turned around in. */
const NOT_THROUGH_ROADS = ['highway=service', 'highway=track', 'highway=footway', 'highway=cycleway', 'highway=path', 'highway=pedestrian', 'highway=living_street'];

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
       SELECT lon, lat FROM places
       WHERE kind = 'street' AND (poi_type IS NULL OR poi_type NOT IN ($3, $4, $5, $6, $7, $8, $9))
       ORDER BY point(lon, lat) <-> point(p.lon, p.lat) LIMIT 1
     ) s`,
    [
      points.map((p) => p[0]),
      points.map((p) => p[1]),
      // Dead ends and back lanes force U-turns when used as a waypoint.
      ...NOT_THROUGH_ROADS,
    ],
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
