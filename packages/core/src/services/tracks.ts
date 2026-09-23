import {
  type LngLat,
  type Mode,
  type TimedCell,
  type TrackBatchRequest,
  type TrackPoint,
  type TrackSource,
  type TripDetail,
  type TripSummary,
  SOFT_DELETE_RETENTION_DAYS,
  cellToBigInt,
  filterPoints,
  inferMode,
  lineLengthM,
  parentCell,
  segmentTrips,
  simplifyLine,
  timedPathCells,
} from '@wayfinder/shared';
import type { PoolClient } from 'pg';
import { type Db, type DbClient, withTransaction } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import type { JobQueue } from './context.js';

const TRIP_GAP_MS = 10 * 60_000;
const MIN_TRIP_M = 100;
const MODE_BIT: Record<Mode, number> = { car: 1, foot: 2 };

export async function ingestBatch(
  db: Db,
  queue: JobQueue,
  userId: string,
  req: TrackBatchRequest,
): Promise<{ accepted: number; duplicate: boolean }> {
  const accepted = await withTransaction(db, async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO track_batches (batch_id, user_id, source, mode, navigation_session_id, point_count)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (batch_id) DO NOTHING`,
      [req.batchId, userId, req.source, req.mode ?? null, req.navigationSessionId ?? null, req.points.length],
    );
    if (inserted.rowCount === 0) return null;
    await tx.query(
      `INSERT INTO track_points
         (user_id, batch_id, source, mode, navigation_session_id, ts, lon, lat, accuracy_m, speed_mps, heading_deg)
       SELECT $1, $2, $3, $4, $5, to_timestamp(t.ts / 1000.0), t.lon, t.lat, t.acc, t.spd, t.hdg
       FROM unnest($6::float8[], $7::float8[], $8::float8[], $9::real[], $10::real[], $11::real[])
         AS t(ts, lon, lat, acc, spd, hdg)`,
      [
        userId,
        req.batchId,
        req.source,
        req.mode ?? null,
        req.navigationSessionId ?? null,
        req.points.map((p) => p.ts),
        req.points.map((p) => p.lon),
        req.points.map((p) => p.lat),
        req.points.map((p) => p.accuracyM ?? null),
        req.points.map((p) => p.speedMps ?? null),
        req.points.map((p) => p.headingDeg ?? null),
      ],
    );
    return req.points.length;
  });
  if (accepted === null) return { accepted: 0, duplicate: true };
  await queue.send('process-tracks', { userId }, { singletonKey: `process-tracks:${userId}` });
  return { accepted, duplicate: false };
}

interface PointRow {
  id: string;
  ts: Date;
  lon: number;
  lat: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  source: TrackSource;
  mode: Mode | null;
  navigation_session_id: string | null;
}

type IdPoint = TrackPoint & { id: string | null };

const toPoint = (r: PointRow): IdPoint => ({
  id: r.id,
  ts: r.ts.getTime(),
  lon: r.lon,
  lat: r.lat,
  accuracyM: r.accuracy_m,
  speedMps: r.speed_mps,
});

async function lockUser(tx: PoolClient, userId: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tracks:${userId}`]);
}

/** Upsert visited cells for a stretch of track; returns how many cells were new. */
async function upsertCells(tx: DbClient, userId: string, cells: TimedCell[], mode: Mode): Promise<number> {
  if (cells.length === 0) return 0;
  const r = await tx.query<{ inserted: boolean }>(
    `INSERT INTO visited_cells (user_id, cell, r7, r5, first_visited_at, last_visited_at, visit_count, modes)
     SELECT $1, t.cell, t.r7, t.r5, to_timestamp(t.f / 1000.0), to_timestamp(t.l / 1000.0), 1, $7
     FROM unnest($2::bigint[], $3::bigint[], $4::bigint[], $5::float8[], $6::float8[]) AS t(cell, r7, r5, f, l)
     ON CONFLICT (user_id, cell) DO UPDATE SET
       first_visited_at = LEAST(visited_cells.first_visited_at, EXCLUDED.first_visited_at),
       last_visited_at = GREATEST(visited_cells.last_visited_at, EXCLUDED.last_visited_at),
       visit_count = visited_cells.visit_count + 1,
       modes = visited_cells.modes | EXCLUDED.modes
     RETURNING (xmax = 0) AS inserted`,
    [
      userId,
      cells.map((c) => cellToBigInt(c.cell).toString()),
      cells.map((c) => cellToBigInt(parentCell(c.cell, 7)).toString()),
      cells.map((c) => cellToBigInt(parentCell(c.cell, 5)).toString()),
      cells.map((c) => c.firstTs),
      cells.map((c) => c.lastTs),
      MODE_BIT[mode],
    ],
  );
  return r.rows.filter((row) => row.inserted).length;
}

const toGeometry = (pts: readonly TrackPoint[]): LngLat[] => pts.map((p) => [p.lon, p.lat]);

/** Simplify a display geometry to at most ~2000 vertices. */
function displayGeometry(coords: LngLat[]): LngLat[] {
  let tol = 3;
  let out = simplifyLine(coords, tol);
  while (out.length > 2000 && tol < 500) {
    tol *= 2;
    out = simplifyLine(coords, tol);
  }
  return out.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
}

interface TripRow {
  id: string;
  mode: Mode;
  ended_at: Date;
  geometry: LngLat[];
  distance_m: number;
}

/**
 * Assign a user's unprocessed points to trips and update their coverage.
 * Background points are segmented by gaps/stops; navigation sessions each form one trip.
 */
export async function processUserTracks(db: Db, userId: string): Promise<{ tripsTouched: number; newCells: number }> {
  return withTransaction(db, async (tx) => {
    await lockUser(tx, userId);
    const rows = (
      await tx.query<PointRow>(
        `SELECT id, ts, lon, lat, accuracy_m, speed_mps, source, mode, navigation_session_id
         FROM track_points WHERE user_id = $1 AND trip_id IS NULL ORDER BY ts LIMIT 200000`,
        [userId],
      )
    ).rows;
    if (rows.length === 0) return { tripsTouched: 0, newCells: 0 };

    const groups = new Map<string, PointRow[]>();
    for (const r of rows) {
      const key = r.navigation_session_id ?? `background:${r.source}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    let tripsTouched = 0;
    let newCells = 0;
    const assigned = new Set<string>();

    for (const [key, groupRows] of groups) {
      const first = groupRows[0]!;
      const isNav = first.navigation_session_id !== null;
      const existing = isNav
        ? (
            await tx.query<TripRow>(
              `SELECT id, mode, ended_at, geometry, distance_m FROM trips
               WHERE user_id = $1 AND navigation_session_id = $2 AND deleted_at IS NULL`,
              [userId, key],
            )
          ).rows[0]
        : (
            await tx.query<TripRow>(
              `SELECT id, mode, ended_at, geometry, distance_m FROM trips
               WHERE user_id = $1 AND source = 'background' AND navigation_session_id IS NULL
                 AND deleted_at IS NULL AND ended_at >= $2 AND ended_at <= $3
               ORDER BY ended_at DESC LIMIT 1`,
              [userId, new Date(first.ts.getTime() - TRIP_GAP_MS), first.ts],
            )
          ).rows[0];

      const context: IdPoint | null =
        existing && existing.geometry.length > 0
          ? {
              id: null,
              ts: existing.ended_at.getTime(),
              lon: existing.geometry[existing.geometry.length - 1]![0],
              lat: existing.geometry[existing.geometry.length - 1]![1],
            }
          : null;

      const filtered = filterPoints([...(context ? [context] : []), ...groupRows.map(toPoint)]);
      const segments = isNav ? (filtered.length ? [filtered] : []) : segmentTrips(filtered, { minTripDistanceM: 0 });

      for (const seg of segments) {
        const continues = context !== null && seg[0] === context;
        const newPts = seg.filter((p): p is IdPoint & { id: string } => p.id !== null);
        if (newPts.length === 0) continue;
        const lengthM = lineLengthM(toGeometry(seg));
        if (!continues && (seg.length < 2 || (!isNav && lengthM < MIN_TRIP_M))) continue;

        const mode: Mode = continues ? existing!.mode : (first.mode ?? inferMode(seg));
        let tripId: string;
        if (continues) {
          tripId = existing!.id;
          const geometry = displayGeometry([...existing!.geometry, ...toGeometry(newPts)]);
          // The trip is longer than when it was last snapped to roads, so drop the old match:
          // otherwise everything travelled after the first upload never counts as road covered.
          await tx.query(
            `UPDATE trips SET ended_at = $2, distance_m = distance_m + $3, point_count = point_count + $4, geometry = $5,
                              matched_geometry = NULL, matched_m = 0
             WHERE id = $1`,
            [tripId, new Date(seg[seg.length - 1]!.ts), lengthM, newPts.length, JSON.stringify(geometry)],
          );
        } else {
          tripId = (
            await tx.query<{ id: string }>(
              `INSERT INTO trips (user_id, mode, source, navigation_session_id, started_at, ended_at, distance_m, point_count, geometry)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
              [
                userId,
                mode,
                isNav ? 'navigation' : 'background',
                isNav ? key : null,
                new Date(seg[0]!.ts),
                new Date(seg[seg.length - 1]!.ts),
                lengthM,
                newPts.length,
                JSON.stringify(displayGeometry(toGeometry(seg))),
              ],
            )
          ).rows[0]!.id;
        }
        await tx.query('UPDATE track_points SET trip_id = $1 WHERE id = ANY($2::bigint[])', [
          tripId,
          newPts.map((p) => p.id),
        ]);
        newPts.forEach((p) => assigned.add(p.id));
        const added = await upsertCells(tx, userId, timedPathCells(seg), mode);
        await tx.query('UPDATE trips SET new_cells = new_cells + $2 WHERE id = $1', [tripId, added]);
        newCells += added;
        tripsTouched++;
      }
    }

    // Drop points that were filtered out or belonged to stops/too-short movements.
    const leftover = rows.map((r) => r.id).filter((id) => !assigned.has(id));
    if (leftover.length) {
      // Keep the tail of an in-progress background trip: points from the last few minutes may
      // still be joined by the next batch.
      const cutoff = Date.now() - TRIP_GAP_MS;
      const recent = new Set(rows.filter((r) => r.ts.getTime() > cutoff && !r.navigation_session_id).map((r) => r.id));
      const toDelete = leftover.filter((id) => !recent.has(id));
      if (toDelete.length) await tx.query('DELETE FROM track_points WHERE id = ANY($1::bigint[])', [toDelete]);
    }
    return { tripsTouched, newCells };
  });
}

/** Recompute a user's visited cells and per-trip new-cell counts from non-deleted trips. */
export async function rebuildCoverage(db: Db, userId: string): Promise<{ cells: number }> {
  return withTransaction(db, async (tx) => {
    await lockUser(tx, userId);
    await tx.query('DELETE FROM visited_cells WHERE user_id = $1', [userId]);
    // Roads are re-matched afterwards (see roadService.matchTrips).
    await tx.query('DELETE FROM visited_ways WHERE user_id = $1', [userId]);
    await tx.query('UPDATE trips SET matched_geometry = NULL, matched_m = 0, new_roads = 0 WHERE user_id = $1', [userId]);
    const trips = (
      await tx.query<{ id: string; mode: Mode }>(
        'SELECT id, mode FROM trips WHERE user_id = $1 AND deleted_at IS NULL ORDER BY started_at',
        [userId],
      )
    ).rows;
    let total = 0;
    for (const trip of trips) {
      const pts = (
        await tx.query<{ ts: Date; lon: number; lat: number }>(
          'SELECT ts, lon, lat FROM track_points WHERE trip_id = $1 ORDER BY ts',
          [trip.id],
        )
      ).rows.map((r) => ({ ts: r.ts.getTime(), lon: r.lon, lat: r.lat }));
      const added = await upsertCells(tx, userId, timedPathCells(pts), trip.mode);
      await tx.query('UPDATE trips SET new_cells = $2 WHERE id = $1', [trip.id, added]);
      total += added;
    }
    return { cells: total };
  });
}

interface TripListRow {
  id: string;
  mode: Mode;
  source: TrackSource;
  started_at: Date;
  ended_at: Date;
  distance_m: number;
  new_roads: number;
}

const toSummary = (r: TripListRow): TripSummary => ({
  id: r.id,
  mode: r.mode,
  source: r.source,
  startedAt: r.started_at.toISOString(),
  endedAt: r.ended_at.toISOString(),
  distanceM: r.distance_m,
  newRoads: r.new_roads,
});

export async function listTrips(
  db: DbClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<{ items: TripSummary[]; nextCursor: string | null }> {
  const before = cursor ? new Date(cursor) : null;
  const rows = (
    await db.query<TripListRow>(
      `SELECT id, mode, source, started_at, ended_at, distance_m, new_roads FROM trips
       WHERE user_id = $1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR started_at < $2)
       ORDER BY started_at DESC LIMIT $3`,
      [userId, before, limit + 1],
    )
  ).rows;
  const items = rows.slice(0, limit).map(toSummary);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.startedAt : null };
}

export async function getTrip(db: DbClient, userId: string, tripId: string, includeDeleted = false): Promise<TripDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw notFound('Trip not found');
  const trip = (
    await db.query<TripListRow & { geometry: LngLat[] }>(
      `SELECT id, mode, source, started_at, ended_at, distance_m, new_roads, geometry FROM trips
       WHERE id = $1 AND user_id = $2 AND ($3 OR deleted_at IS NULL)`,
      [tripId, userId, includeDeleted],
    )
  ).rows[0];
  if (!trip) throw notFound('Trip not found');
  const points = (
    await db.query<{ ts: Date; lon: number; lat: number }>(
      'SELECT ts, lon, lat FROM track_points WHERE trip_id = $1 ORDER BY ts',
      [tripId],
    )
  ).rows.map((p) => ({ ts: p.ts.getTime(), lon: p.lon, lat: p.lat }));
  return { ...toSummary(trip), geometry: trip.geometry, points };
}

export async function updateTripMode(db: Db, queue: JobQueue, userId: string, tripId: string, mode: Mode) {
  const r = await db.query('UPDATE trips SET mode = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [
    tripId,
    userId,
    mode,
  ]);
  if (r.rowCount === 0) throw notFound('Trip not found');
  await queue.send('rebuild-coverage', { userId }, { singletonKey: `rebuild-coverage:${userId}` });
}

export async function softDeleteTrip(db: DbClient, queue: JobQueue, userId: string, tripId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw notFound('Trip not found');
  const r = await db.query('UPDATE trips SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [
    tripId,
    userId,
  ]);
  if (r.rowCount === 0) throw notFound('Trip not found');
  await queue.send('rebuild-coverage', { userId }, { singletonKey: `rebuild-coverage:${userId}` });
}

/** Restore a soft-deleted trip still within the retention window. Returns the owner id. */
export async function restoreTrip(db: DbClient, queue: JobQueue, tripId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw notFound('Trip not found');
  const r = await db.query<{ user_id: string }>(
    `UPDATE trips SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at > now() - make_interval(days => $2)
     RETURNING user_id`,
    [tripId, SOFT_DELETE_RETENTION_DAYS],
  );
  const userId = r.rows[0]?.user_id;
  if (!userId) throw notFound('No restorable trip with that id');
  await queue.send('rebuild-coverage', { userId }, { singletonKey: `rebuild-coverage:${userId}` });
  return userId;
}
