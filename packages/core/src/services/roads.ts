import { type BBox, type LngLat, bboxOf, lineLengthM } from '@wayfinder/shared';
import type { Db, DbClient } from '../db/pool.js';
import type { GhPath, GraphHopperClient } from '../lib/graphhopper.js';

/** One stretch of one OSM way that somebody travelled. */
export interface TravelledWay {
  wayId: number;
  geometry: LngLat[];
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
  return [...byWay].map(([wayId, pieces]) => {
    // A way can be entered more than once on one trip; keep the longest run of it.
    const longest = pieces.reduce((best, p) => (lineLengthM(p) > lineLengthM(best) ? p : best));
    return { wayId, geometry: longest, lengthM: lineLengthM(longest) };
  });
}

const MODE_BIT = { car: 1, foot: 2 } as const;

/**
 * Record the ways a trip covered. Longer stretches of a way replace shorter ones. Returns how
 * many of them the person had never been on, which is what a trip reports as new.
 */
export async function recordTravelledWays(
  db: DbClient,
  userId: string,
  ways: readonly TravelledWay[],
  mode: 'car' | 'foot',
  when: Date,
): Promise<number> {
  if (ways.length === 0) return 0;
  const boxes = ways.map((w) => bboxOf(w.geometry));
  const r = await db.query<{ inserted: boolean }>(
    `INSERT INTO visited_ways (user_id, way_id, geometry, length_m, first_visited_at, last_visited_at, modes,
                               min_lon, min_lat, max_lon, max_lat)
     SELECT $1, w, g::jsonb, l, $5, $5, $6, b1, b2, b3, b4
     FROM unnest($2::bigint[], $3::text[], $4::float8[], $7::float8[], $8::float8[], $9::float8[], $10::float8[])
       AS t(w, g, l, b1, b2, b3, b4)
     ON CONFLICT (user_id, way_id) DO UPDATE SET
       last_visited_at = GREATEST(visited_ways.last_visited_at, EXCLUDED.last_visited_at),
       first_visited_at = LEAST(visited_ways.first_visited_at, EXCLUDED.first_visited_at),
       modes = visited_ways.modes | EXCLUDED.modes,
       geometry = CASE WHEN EXCLUDED.length_m > visited_ways.length_m THEN EXCLUDED.geometry ELSE visited_ways.geometry END,
       length_m = GREATEST(visited_ways.length_m, EXCLUDED.length_m),
       min_lon = LEAST(visited_ways.min_lon, EXCLUDED.min_lon),
       min_lat = LEAST(visited_ways.min_lat, EXCLUDED.min_lat),
       max_lon = GREATEST(visited_ways.max_lon, EXCLUDED.max_lon),
       max_lat = GREATEST(visited_ways.max_lat, EXCLUDED.max_lat)
     -- xmax is zero on a row this statement inserted, so this says which roads are new.
     RETURNING (xmax = 0) AS inserted`,
    [
      userId,
      ways.map((w) => String(w.wayId)),
      ways.map((w) => JSON.stringify(w.geometry)),
      ways.map((w) => w.lengthM),
      when,
      MODE_BIT[mode],
      boxes.map((b) => b[0]),
      boxes.map((b) => b[1]),
      boxes.map((b) => b[2]),
      boxes.map((b) => b[3]),
    ],
  );
  return r.rows.filter((x) => x.inserted).length;
}

export interface CoveredRoad {
  wayId: number;
  geometry: LngLat[];
  /** First travelled in the last week. */
  recent: boolean;
  modes: number;
}

/** The roads a person has travelled inside the map view. */
export async function roadsInView(db: DbClient, userId: string, bbox: BBox, limit = 4000): Promise<CoveredRoad[]> {
  const r = await db.query<{ way_id: string; geometry: LngLat[]; recent: boolean; modes: number }>(
    `SELECT way_id::text, geometry, first_visited_at > now() - interval '7 days' AS recent, modes
     FROM visited_ways
     WHERE user_id = $1 AND box(point(min_lon, min_lat), point(max_lon, max_lat)) && box(point($2, $3), point($4, $5))
     ORDER BY length_m DESC
     LIMIT $6`,
    [userId, bbox[0], bbox[1], bbox[2], bbox[3], limit],
  );
  return r.rows.map((x) => ({ wayId: Number(x.way_id), geometry: x.geometry, recent: x.recent, modes: x.modes }));
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
 * Snap trips onto the road network and record the ways they covered. Runs outside the trip
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
    if (!path) {
      // Remember the attempt so it isn't retried on every pass; the raw line still shows.
      await db.query(`UPDATE trips SET matched_geometry = '[]'::jsonb, matched_m = 0 WHERE id = $1`, [trip.id]);
      unmatched++;
      continue;
    }
    const travelled = waysOfPath(path);
    const fresh = await recordTravelledWays(db, userId, travelled, trip.mode, trip.started_at);
    await db.query('UPDATE trips SET matched_geometry = $2::jsonb, matched_m = $3, new_roads = $4 WHERE id = $1', [
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
