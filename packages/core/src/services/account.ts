import { SOFT_DELETE_RETENTION_DAYS } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { getCoverageStats } from './coverage.js';

/** Everything stored about a user, for GET /me/export. */
export async function exportUserData(db: DbClient, userId: string) {
  const user = (await db.query('SELECT id, email, role, settings, created_at FROM users WHERE id = $1', [userId])).rows[0];
  const trips = (
    await db.query<{ id: string; mode: string; source: string; started_at: Date; ended_at: Date; distance_m: number; new_roads: number }>(
      'SELECT id, mode, source, started_at, ended_at, distance_m, new_roads FROM trips WHERE user_id = $1 AND deleted_at IS NULL ORDER BY started_at',
      [userId],
    )
  ).rows;
  const features = [];
  for (const t of trips) {
    const pts = (
      await db.query<{ ts: Date; lon: number; lat: number; accuracy_m: number | null }>(
        'SELECT ts, lon, lat, accuracy_m FROM track_points WHERE trip_id = $1 ORDER BY ts',
        [t.id],
      )
    ).rows;
    features.push({
      type: 'Feature',
      properties: {
        id: t.id,
        mode: t.mode,
        source: t.source,
        startedAt: t.started_at.toISOString(),
        endedAt: t.ended_at.toISOString(),
        distanceM: t.distance_m,
        newRoads: t.new_roads,
        timestamps: pts.map((p) => p.ts.toISOString()),
      },
      geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) },
    });
  }
  // Coverage: the roads travelled, as drawn on the map.
  const roads = (
    await db.query<{ way_id: string; pieces: [number, number][][]; length_m: number; first_visited_at: Date; last_visited_at: Date; modes: number }>(
      `SELECT way_id, coalesce(pieces, jsonb_build_array(geometry)) AS pieces, length_m, first_visited_at, last_visited_at, modes
       FROM visited_ways WHERE user_id = $1 ORDER BY first_visited_at`,
      [userId],
    )
  ).rows.map((r) => ({
    type: 'Feature',
    properties: {
      osmWayId: Number(r.way_id),
      lengthM: r.length_m,
      firstTravelledAt: r.first_visited_at.toISOString(),
      lastTravelledAt: r.last_visited_at.toISOString(),
      modes: [r.modes & 1 ? 'car' : null, r.modes & 2 ? 'foot' : null].filter(Boolean),
    },
    // A road travelled in separate stretches has each of them.
    geometry: r.pieces.length === 1 ? { type: 'LineString', coordinates: r.pieces[0]! } : { type: 'MultiLineString', coordinates: r.pieces },
  }));
  // The internal index explore steers by (never shown in the app, but it is stored about you).
  const cells = (
    await db.query<{ cell: string; first_visited_at: Date; last_visited_at: Date; visit_count: number; modes: number }>(
      'SELECT cell, first_visited_at, last_visited_at, visit_count, modes FROM visited_cells WHERE user_id = $1',
      [userId],
    )
  ).rows.map((c) => ({
    h3: BigInt(c.cell).toString(16),
    firstVisitedAt: c.first_visited_at.toISOString(),
    lastVisitedAt: c.last_visited_at.toISOString(),
    visitCount: c.visit_count,
    modes: [c.modes & 1 ? 'car' : null, c.modes & 2 ? 'foot' : null].filter(Boolean),
  }));
  const planned = (await db.query('SELECT id, name, created_at, route FROM planned_routes WHERE user_id = $1', [userId])).rows;
  const saved = (await db.query('SELECT name, description, lon, lat, created_at FROM saved_places WHERE user_id = $1 ORDER BY lower(name)', [userId])).rows;
  return {
    exportedAt: new Date().toISOString(),
    user,
    stats: await getCoverageStats(db, userId),
    trips: { type: 'FeatureCollection', features },
    travelledRoads: { type: 'FeatureCollection', features: roads },
    visitedCells: cells,
    plannedRoutes: planned,
    savedPlaces: saved,
    note: `Deleted items are kept for ${SOFT_DELETE_RETENTION_DAYS} days before permanent removal.`,
  };
}
