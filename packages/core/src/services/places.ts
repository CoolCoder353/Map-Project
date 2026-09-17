import {
  type LngLat,
  type Place,
  type PlannedRoute,
  type Route,
  cellToBigInt,
  haversineM,
  pointToCell,
} from '@wayfinder/shared';
import { gridDisk } from 'h3-js';
import type { DbClient } from '../db/pool.js';
import { notFound } from '../lib/errors.js';

interface PlaceRow {
  id: string;
  name: string;
  kind: string;
  description: string;
  lon: number;
  lat: number;
  importance: number;
  sim: number;
}

const KIND_BOOST: Record<string, number> = { city: 0.35, town: 0.3, suburb: 0.2, poi: 0.1, street: 0.05, address: 0 };

const toPlace = (r: PlaceRow): Place => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  description: r.description,
  location: [r.lon, r.lat],
});

export async function searchPlaces(db: DbClient, q: string, near: LngLat | null, limit: number): Promise<Place[]> {
  const rows = (
    await db.query<PlaceRow>(
      `SELECT id, name, kind, description, lon, lat, importance, similarity(name, $1) AS sim
       FROM places
       WHERE name % $1 OR name ILIKE $2
       ORDER BY sim DESC
       LIMIT 300`,
      [q, `${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`],
    )
  ).rows;
  const lower = q.toLowerCase();
  return rows
    .map((r) => {
      let score = r.sim + (r.name.toLowerCase().startsWith(lower) ? 0.3 : 0) + (KIND_BOOST[r.kind] ?? 0) + r.importance * 0.2;
      if (near) score += 0.6 * Math.exp(-haversineM(near, [r.lon, r.lat]) / 25_000);
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => toPlace(r));
}

export async function reverseGeocode(db: DbClient, p: LngLat): Promise<Place | null> {
  const near = gridDisk(pointToCell(p, 9), 2).map((c) => cellToBigInt(c).toString());
  const rows = (
    await db.query<PlaceRow>(
      `SELECT id, name, kind, description, lon, lat, importance, 0 AS sim FROM places
       WHERE r9 = ANY($1::bigint[]) AND kind IN ('address', 'street', 'poi')`,
      [near],
    )
  ).rows;
  const rank: Record<string, number> = { address: 0, poi: 30, street: 60 };
  const best = rows
    .map((r) => ({ r, d: haversineM(p, [r.lon, r.lat]) + (rank[r.kind] ?? 100) }))
    .sort((a, b) => a.d - b.d)[0];
  if (best) return toPlace(best.r);
  const area = (
    await db.query<PlaceRow>(
      `SELECT id, name, kind, description, lon, lat, importance, 0 AS sim FROM places
       WHERE r7 = ANY($1::bigint[]) AND kind IN ('suburb', 'town', 'city')`,
      [gridDisk(pointToCell(p, 7), 1).map((c) => cellToBigInt(c).toString())],
    )
  ).rows.sort((a, b) => haversineM(p, [a.lon, a.lat]) - haversineM(p, [b.lon, b.lat]))[0];
  return area ? toPlace(area) : null;
}

export interface PlaceInput {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  description: string;
  lon: number;
  lat: number;
  importance: number;
}

/** Bulk upsert places (used by the OSM importer and tests). */
export async function upsertPlaces(db: DbClient, places: PlaceInput[], table = 'places'): Promise<void> {
  if (places.length === 0) return;
  await db.query(
    `INSERT INTO ${table} (id, name, kind, category, description, lon, lat, r9, r7, importance)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[],
                          $8::bigint[], $9::bigint[], $10::real[])
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, category = EXCLUDED.category,
       description = EXCLUDED.description, lon = EXCLUDED.lon, lat = EXCLUDED.lat, r9 = EXCLUDED.r9,
       r7 = EXCLUDED.r7, importance = EXCLUDED.importance`,
    [
      places.map((p) => p.id),
      places.map((p) => p.name),
      places.map((p) => p.kind),
      places.map((p) => p.category),
      places.map((p) => p.description),
      places.map((p) => p.lon),
      places.map((p) => p.lat),
      places.map((p) => cellToBigInt(pointToCell([p.lon, p.lat], 9)).toString()),
      places.map((p) => cellToBigInt(pointToCell([p.lon, p.lat], 7)).toString()),
      places.map((p) => p.importance),
    ],
  );
}


interface PlannedRow {
  id: string;
  name: string;
  created_at: Date;
  route: Route;
}

const toPlanned = (r: PlannedRow): PlannedRoute => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at.toISOString(),
  route: r.route,
});

export async function createPlannedRoute(db: DbClient, userId: string, name: string, route: Route): Promise<PlannedRoute> {
  const r = await db.query<PlannedRow>(
    'INSERT INTO planned_routes (user_id, name, route) VALUES ($1, $2, $3) RETURNING id, name, created_at, route',
    [userId, name, JSON.stringify(route)],
  );
  return toPlanned(r.rows[0]!);
}

export async function listPlannedRoutes(db: DbClient, userId: string): Promise<PlannedRoute[]> {
  const r = await db.query<PlannedRow>(
    'SELECT id, name, created_at, route FROM planned_routes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [userId],
  );
  return r.rows.map(toPlanned);
}

export async function deletePlannedRoute(db: DbClient, userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Planned route not found');
  const r = await db.query('DELETE FROM planned_routes WHERE id = $1 AND user_id = $2', [id, userId]);
  if (r.rowCount === 0) throw notFound('Planned route not found');
}
