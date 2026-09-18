import {
  type LngLat,
  type Place,
  type PlannedRoute,
  type Route,
  categoryTypes,
  cellToBigInt,
  haversineM,
  placeContext,
  poiTypeLabel,
  pointToCell,
} from '@wayfinder/shared';
import { gridDisk } from 'h3-js';
import type { DbClient } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { placeHours } from '../lib/hours.js';

interface PlaceRow {
  id: string;
  name: string;
  kind: string;
  description: string;
  lon: number;
  lat: number;
  importance: number;
  sim: number;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  poi_type: string | null;
  opening_hours: string | null;
}

const COLUMNS = 'id, name, kind, description, lon, lat, importance, suburb, state, postcode, poi_type, opening_hours';

const KIND_BOOST: Record<string, number> = { city: 0.35, town: 0.3, suburb: 0.2, poi: 0.1, street: 0.05, address: 0 };
const KIND_LABEL: Record<string, string> = { street: 'Street', address: 'Address' };

function typeLabel(r: PlaceRow): string {
  if (r.kind === 'poi') return r.poi_type ? poiTypeLabel(r.poi_type) : r.description.split(',')[0]!.replace(/^\w/, (c) => c.toUpperCase());
  // Settlements keep OSM's own word: City, Town, Village, Suburb, Locality…
  return KIND_LABEL[r.kind] ?? r.description.split(',')[0] ?? r.kind;
}

function toPlace(r: PlaceRow, origin: LngLat | null = null, now = new Date()): Place {
  const label = typeLabel(r);
  const context = placeContext(r);
  const hours = r.kind === 'poi' ? placeHours(r.opening_hours, r.state, now) : null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    // Older app builds show only this line.
    description: context ? [label, context].join(' · ') : r.description,
    location: [r.lon, r.lat],
    typeLabel: label,
    ...(context ? { context } : {}),
    ...(origin ? { distanceM: Math.round(haversineM(origin, [r.lon, r.lat])) } : {}),
    ...(hours ? { hours } : {}),
  };
}

/**
 * How well a candidate answers the query: text match plus a strong pull toward the origin.
 * Nearby matches dominate, but an exact match on a big place (a city by name) still surfaces.
 */
export function searchScore(
  r: { name: string; kind: string; importance: number; sim: number; lon: number; lat: number },
  q: string,
  origin: LngLat | null,
): number {
  const name = r.name.toLowerCase();
  const lower = q.trim().toLowerCase();
  let score = r.sim + (name.startsWith(lower) ? 0.3 : 0) + (name === lower ? 0.5 : 0) + (KIND_BOOST[r.kind] ?? 0) + r.importance * 0.2;
  if (origin) {
    const d = haversineM(origin, [r.lon, r.lat]);
    score += 1.2 * Math.exp(-d / 15_000) + 0.4 * Math.exp(-d / 150_000);
  }
  return score;
}

const box = (o: LngLat, deg: number) => [o[0] - deg / Math.cos((o[1] * Math.PI) / 180), o[1] - deg, o[0] + deg / Math.cos((o[1] * Math.PI) / 180), o[1] + deg];

/**
 * Place search. Candidates come from three pools: the nearest text matches within ~50 km and
 * ~450 km of the origin, and the best text matches nationwide, so chain stores find their
 * nearest branches and a distant city can still be found by name. A query that names a kind of
 * place ("petrol", "pharmacy") lists the nearest of that kind first.
 */
export async function searchPlaces(db: DbClient, q: string, near: LngLat | null, limit: number, now = new Date()): Promise<Place[]> {
  const prefix = `${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const match = `(name % $1 OR name ILIKE $2 OR brand % $1)`;
  const sim = `greatest(similarity(name, $1), coalesce(similarity(brand, $1), 0)) AS sim`;
  const pools: Array<Promise<{ rows: PlaceRow[] }>> = [
    db.query<PlaceRow>(`SELECT ${COLUMNS}, ${sim} FROM places WHERE ${match} ORDER BY sim DESC LIMIT 100`, [q, prefix]),
  ];
  if (near) {
    for (const [deg, n] of [[0.45, 150], [4, 100]] as const) {
      const [x0, y0, x1, y1] = box(near, deg);
      pools.push(
        db.query<PlaceRow>(
          `SELECT ${COLUMNS}, ${sim} FROM places
           WHERE point(lon, lat) <@ box(point($3, $4), point($5, $6)) AND ${match}
           ORDER BY point(lon, lat) <-> point($7, $8) LIMIT ${n}`,
          [q, prefix, x0, y0, x1, y1, near[0], near[1]],
        ),
      );
    }
  }
  const types = categoryTypes(q);
  const category =
    types && near
      ? await db.query<PlaceRow>(
          `SELECT ${COLUMNS}, 1 AS sim FROM places WHERE poi_type = ANY($1::text[])
           ORDER BY point(lon, lat) <-> point($2, $3) LIMIT $4`,
          [types, near[0], near[1], limit],
        )
      : { rows: [] as PlaceRow[] };

  const seen = new Set(category.rows.map((r) => r.id));
  const named = new Map<string, PlaceRow>();
  for (const { rows } of await Promise.all(pools)) for (const r of rows) if (!seen.has(r.id)) named.set(r.id, r);
  const ranked = [...named.values()]
    .map((r) => ({ r, score: searchScore(r, q, near) }))
    .sort((a, b) => b.score - a.score)
    .map(({ r }) => r);
  return [...category.rows, ...ranked].slice(0, limit).map((r) => toPlace(r, near, now));
}

export async function reverseGeocode(db: DbClient, p: LngLat): Promise<Place | null> {
  const near = gridDisk(pointToCell(p, 9), 2).map((c) => cellToBigInt(c).toString());
  const rows = (
    await db.query<PlaceRow>(
      `SELECT ${COLUMNS}, 0 AS sim FROM places
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
      `SELECT ${COLUMNS}, 0 AS sim FROM places
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
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  poiType?: string | null;
  brand?: string | null;
  openingHours?: string | null;
}

/** Bulk upsert places (used by the OSM importer and tests). */
export async function upsertPlaces(db: DbClient, places: PlaceInput[], table = 'places'): Promise<void> {
  if (places.length === 0) return;
  await db.query(
    `INSERT INTO ${table} (id, name, kind, category, description, lon, lat, r9, r7, importance,
                           suburb, state, postcode, poi_type, brand, opening_hours)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[],
                          $8::bigint[], $9::bigint[], $10::real[],
                          $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[])
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, category = EXCLUDED.category,
       description = EXCLUDED.description, lon = EXCLUDED.lon, lat = EXCLUDED.lat, r9 = EXCLUDED.r9,
       r7 = EXCLUDED.r7, importance = EXCLUDED.importance, suburb = EXCLUDED.suburb, state = EXCLUDED.state,
       postcode = EXCLUDED.postcode, poi_type = EXCLUDED.poi_type, brand = EXCLUDED.brand,
       opening_hours = EXCLUDED.opening_hours`,
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
      places.map((p) => p.suburb ?? null),
      places.map((p) => p.state ?? null),
      places.map((p) => p.postcode ?? null),
      places.map((p) => p.poiType ?? null),
      places.map((p) => p.brand ?? null),
      places.map((p) => p.openingHours ?? null),
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
