import { type BBox, type LngLat, bboxOf, lineLengthM, mergeStretches } from '@wayfinder/shared';
import { type Db, type DbClient, withTransaction } from '../db/pool.js';
import type { GhPath, GraphHopperClient } from '../lib/graphhopper.js';
import { recordSpeedSamples, speedSamples } from './road-speeds.js';
import { lightPasses, recordLightPasses } from './light-timing.js';
import { signalsIn } from './road-facts.js';

/** The stretches of one OSM way that a trip travelled. */
export interface TravelledWay {
  wayId: number;
  pieces: LngLat[][];
  lengthM: number;
}

/**
 * Split a matched path into the pieces of each OSM way it used. GraphHopper reports way ids as
 * [firstPoint, lastPoint, wayId] runs over the path's coordinates.
 */
export function waysOfPath(path: GhPath): TravelledWay[] {
  const coords = path.points.coordinates;
  const runs = path.details?.osm_way_id ?? [];
  const byWay = new Map<number, LngLat[][]>();
  for (const [from, to, wayId] of runs) {
    if (!Number.isFinite(wayId) || wayId <= 0) continue;
    const piece = coords.slice(from, to + 1);
    if (piece.length < 2) continue;
    byWay.set(wayId, [...(byWay.get(wayId) ?? []), piece]);
  }
  // A way can be entered more than once on one trip: different stretches each count, the same
  // stretch twice (there and back) once.
  // A way only brushed past (a repeated point, no distance along it) wasn't travelled.
  return [...byWay].flatMap(([wayId, pieces]) => {
    const { stretches, addedM } = mergeStretches([], pieces);
    return stretches.length > 0 ? [{ wayId, pieces: stretches, lengthM: addedM }] : [];
  });
}

const MODE_BIT = { car: 1, foot: 2 } as const;

const longest = (pieces: LngLat[][]) => pieces.reduce((best, p) => (lineLengthM(p) > lineLengthM(best) ? p : best));

/**
 * Record the ways a trip covered. Each new stretch of a way is kept alongside the ones already
 * travelled, and the way's length counts each metre once. Returns how many of the ways the person
 * had never been on, which is what a trip reports as new.
 */
export async function recordTravelledWays(
  db: Db,
  userId: string,
  ways: readonly TravelledWay[],
  mode: 'car' | 'foot',
  when: Date,
): Promise<number> {
  ways = ways.filter((w) => w.pieces.length > 0);
  if (ways.length === 0) return 0;
  return withTransaction(db, async (tx) => {
    const known = new Map(
      (
        await tx.query<{ way_id: string; pieces: LngLat[][]; length_m: number }>(
          `SELECT way_id::text, coalesce(pieces, jsonb_build_array(geometry)) AS pieces, length_m FROM visited_ways
           WHERE user_id = $1 AND way_id = ANY($2::bigint[]) FOR UPDATE`,
          [userId, ways.map((w) => String(w.wayId))],
        )
      ).rows.map((r) => [Number(r.way_id), r]),
    );
    const rows = ways.map((w) => {
      const before = known.get(w.wayId);
      const { stretches, addedM } = mergeStretches(before?.pieces ?? [], w.pieces);
      return { wayId: w.wayId, pieces: stretches, lengthM: (before?.length_m ?? 0) + addedM, box: bboxOf(stretches.flat()) };
    });
    await tx.query(
      `INSERT INTO visited_ways (user_id, way_id, geometry, pieces, length_m, first_visited_at, last_visited_at, modes,
                                 min_lon, min_lat, max_lon, max_lat)
       SELECT $1, w, g::jsonb, p::jsonb, l, $6, $6, $7, b1, b2, b3, b4
       FROM unnest($2::bigint[], $3::text[], $4::text[], $5::float8[], $8::float8[], $9::float8[], $10::float8[], $11::float8[])
         AS t(w, g, p, l, b1, b2, b3, b4)
       ON CONFLICT (user_id, way_id) DO UPDATE SET
         last_visited_at = GREATEST(visited_ways.last_visited_at, EXCLUDED.last_visited_at),
         first_visited_at = LEAST(visited_ways.first_visited_at, EXCLUDED.first_visited_at),
         modes = visited_ways.modes | EXCLUDED.modes,
         geometry = EXCLUDED.geometry,
         pieces = EXCLUDED.pieces,
         length_m = EXCLUDED.length_m,
         min_lon = EXCLUDED.min_lon,
         min_lat = EXCLUDED.min_lat,
         max_lon = EXCLUDED.max_lon,
         max_lat = EXCLUDED.max_lat`,
      [
        userId,
        rows.map((r) => String(r.wayId)),
        rows.map((r) => JSON.stringify(longest(r.pieces))),
        rows.map((r) => JSON.stringify(r.pieces)),
        rows.map((r) => r.lengthM),
        when,
        MODE_BIT[mode],
        rows.map((r) => r.box[0]),
        rows.map((r) => r.box[1]),
        rows.map((r) => r.box[2]),
        rows.map((r) => r.box[3]),
      ],
    );
    return ways.filter((w) => !known.has(w.wayId)).length;
  });
}

export interface CoveredRoad {
  wayId: number;
  geometry: LngLat[];
  /** First travelled in the last week. */
  recent: boolean;
  modes: number;
  firstAt?: string;
  lastAt?: string;
}

/** The roads a person has travelled inside the map view. */
export async function roadsInView(db: DbClient, userId: string, bbox: BBox, limit = 4000): Promise<CoveredRoad[]> {
  const r = await db.query<{ way_id: string; pieces: LngLat[][]; recent: boolean; modes: number; first_visited_at: Date; last_visited_at: Date | null }>(
    `SELECT way_id::text, coalesce(pieces, jsonb_build_array(geometry)) AS pieces, first_visited_at > now() - interval '7 days' AS recent, modes,
            first_visited_at, last_visited_at
     FROM visited_ways
     WHERE user_id = $1 AND box(point(min_lon, min_lat), point(max_lon, max_lat)) && box(point($2, $3), point($4, $5))
     ORDER BY length_m DESC
     LIMIT $6`,
    [userId, bbox[0], bbox[1], bbox[2], bbox[3], limit],
  );
  // A road travelled in separate stretches is drawn as each of them.
  return r.rows.flatMap((x) =>
    x.pieces.map((geometry) => ({
      wayId: Number(x.way_id),
      geometry,
      recent: x.recent,
      modes: x.modes,
      firstAt: x.first_visited_at.toISOString(),
      lastAt: (x.last_visited_at ?? x.first_visited_at).toISOString(),
    })),
  );
}

/** The way ids a person has travelled, for scoring how new a route is. */
export async function visitedWayIds(db: DbClient, userId: string, bbox?: BBox): Promise<Set<number>> {
  const r = await db.query<{ way_id: string }>(
    bbox
      ? `SELECT way_id::text FROM visited_ways WHERE user_id = $1
         AND box(point(min_lon, min_lat), point(max_lon, max_lat)) && box(point($2, $3), point($4, $5))`
      : 'SELECT way_id::text FROM visited_ways WHERE user_id = $1',
    bbox ? [userId, bbox[0], bbox[1], bbox[2], bbox[3]] : [userId],
  );
  return new Set(r.rows.map((x) => Number(x.way_id)));
}

/**
 * Snap trips onto the road network and record the ways they covered, and for drives how fast each
 * road went. Runs outside the trip
 * transaction: matching is a call to the routing engine, not a database operation.
 */
export async function matchTrips(
  db: Db,
  graphhopper: Pick<GraphHopperClient, 'match'>,
  userId: string,
  limit = 25,
): Promise<{ matched: number; unmatched: number; ways: number }> {
  const trips = (
    await db.query<{ id: string; mode: 'car' | 'foot'; started_at: Date }>(
      // Oldest first, so a road counts as new for the trip that first travelled it.
      `SELECT id, mode, started_at FROM trips
       WHERE user_id = $1 AND deleted_at IS NULL AND matched_geometry IS NULL
       ORDER BY started_at LIMIT $2`,
      [userId, limit],
    )
  ).rows;
  let matched = 0;
  let unmatched = 0;
  let ways = 0;
  for (const trip of trips) {
    const points = (
      await db.query<{ ts: Date; lon: number; lat: number }>('SELECT ts, lon, lat FROM track_points WHERE trip_id = $1 ORDER BY ts', [trip.id])
    ).rows.map((p) => ({ lon: p.lon, lat: p.lat, ts: p.ts.getTime() }));
    const path = await graphhopper.match(points, trip.mode);
    // A match far longer than the line recorded didn't follow the trip: sparse or jumping fixes
    // let the engine wander the street grid between them (a 1.6 km drive once matched 11.5 km and
    // 185 roads). Crediting it would fill coverage with roads never driven, so it counts as none.
    if (!path || !plausibleMatch(points, path.points.coordinates)) {
      // Remember the attempt so it isn't retried on every pass; the raw line still shows.
      await db.query(`UPDATE trips SET matched_geometry = '[]'::jsonb, matched_m = 0 WHERE id = $1`, [trip.id]);
      unmatched++;
      continue;
    }
    const travelled = waysOfPath(path);
    // Drives also say how fast each road really goes, for travel times.
    if (trip.mode === 'car') {
      await recordSpeedSamples(db, trip.id, speedSamples(path.points.coordinates, path.details?.osm_way_id ?? [], points, path.details?.max_speed ?? []));
      // And how long each set of lights held it.
      const signals = await signalsIn(db, bboxOf(path.points.coordinates, 30));
      await recordLightPasses(db, trip.id, lightPasses(path.points.coordinates, points, signals));
    }
    const fresh = await recordTravelledWays(db, userId, travelled, trip.mode, trip.started_at);
    // Added, not set: a trip still being recorded is matched again each time it grows, and the
    // roads it was first on earlier are no longer new by then.
    await db.query('UPDATE trips SET matched_geometry = $2::jsonb, matched_m = $3, new_roads = new_roads + $4 WHERE id = $1', [
      trip.id,
      JSON.stringify(path.points.coordinates),
      path.distance,
      fresh,
    ]);
    matched++;
    ways += travelled.length;
  }
  return { matched, unmatched, ways };
}

/** A matched path may run this much longer than the recorded line (roads curve between fixes), plus [MATCH_SLACK_M]. */
export const MATCH_MAX_RATIO = 1.5;
export const MATCH_SLACK_M = 300;

/** Whether a matched path is about as long as the line recorded, so it can be what was driven. */
export function plausibleMatch(points: ReadonlyArray<{ lon: number; lat: number }>, matched: ReadonlyArray<LngLat>): boolean {
  const recorded = lineLengthM(points.map((p) => [p.lon, p.lat] as LngLat));
  return lineLengthM([...matched]) <= recorded * MATCH_MAX_RATIO + MATCH_SLACK_M;
}

/** How much road a person has travelled, for the coverage stats. */
export async function roadStats(db: DbClient, userId: string): Promise<{ km: number; ways: number; newThisWeek: number; newThisMonth: number; carKm: number; footKm: number }> {
  const r = await db.query<{ km: string; ways: string; week: string; month: string; car_km: string; foot_km: string }>(
    `SELECT coalesce(sum(length_m), 0) / 1000 AS km,
            count(*) AS ways,
            count(*) FILTER (WHERE first_visited_at > now() - interval '7 days') AS week,
            count(*) FILTER (WHERE first_visited_at > now() - interval '30 days') AS month,
            coalesce(sum(length_m) FILTER (WHERE modes & 1 > 0), 0) / 1000 AS car_km,
            coalesce(sum(length_m) FILTER (WHERE modes & 2 > 0), 0) / 1000 AS foot_km
     FROM visited_ways WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0]!;
  return {
    km: Number(row.km),
    ways: Number(row.ways),
    newThisWeek: Number(row.week),
    newThisMonth: Number(row.month),
    carKm: Number(row.car_km),
    footKm: Number(row.foot_km),
  };
}
