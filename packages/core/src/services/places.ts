import {
  type LngLat,
  type Place,
  type PlannedRoute,
  type Route,
  categoryTypes,
  cellToBigInt,
  expandAbbreviations,
  haversineM,
  placeContext,
  poiTypeLabel,
  pointToCell,
  splitAddress,
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

const SETTLEMENT = new Set(['city', 'town', 'suburb']);

/**
 * How well a candidate answers the query: text match plus a pull toward the origin. The pull is
 * scaled by match quality, so a nearby partial match ("Erin Street" for "Main Street") doesn't
 * beat an exact one further away, while exact matches (every "Woolworths") are ordered by distance.
 */
export function searchScore(
  r: { name: string; kind: string; importance: number; sim: number; lon: number; lat: number },
  q: string,
  origin: LngLat | null,
): number {
  const name = r.name.toLowerCase();
  const lower = q.trim().toLowerCase();
  const exact = name === lower;
  const prefix = name.startsWith(lower);
  let score = r.sim + (prefix ? 0.3 : 0) + (exact ? 0.25 : 0) + (exact && SETTLEMENT.has(r.kind) ? 0.35 : 0) + (KIND_BOOST[r.kind] ?? 0) + r.importance * 0.2;
  if (origin) {
    const quality = exact ? 1 : prefix ? 0.9 : Math.min(1, Math.max(0, (r.sim - 0.3) / 0.5)) ** 2;
    const d = haversineM(origin, [r.lon, r.lat]);
    score += quality * (1.5 * Math.exp(-d / 20_000) + 0.4 * Math.exp(-d / 150_000));
  }
  return score;
}

/** The same place mapped twice (a shop as a point and as a building): keep the better-ranked one. */
function sameThing(a: PlaceRow, b: PlaceRow): boolean {
  return (
    a.name.toLowerCase() === b.name.toLowerCase() &&
    a.kind === b.kind &&
    a.poi_type === b.poi_type &&
    (!a.suburb || !b.suburb || a.suburb === b.suburb) &&
    haversineM([a.lon, a.lat], [b.lon, b.lat]) < 300
  );
}


/**
 * Place search. Candidates come from these pools:
 *  - fuzzy text matches (typos, partial words) among the 30,000 places nearest the origin;
 *  - exact and prefix name or brand matches at any distance, nearest first, so every
 *    "Main Street" or "Woolworths" is considered and chains find their nearest branches;
 *  - fuzzy matches on suburb, town and city names nationwide, so "canbera" finds Canberra.
 * Fuzzy matching over every name nationwide is avoided: common words ("Street") match hundreds of
 * thousands of names. A query that names a kind of place ("petrol", "pharmacy") lists the nearest
 * of that kind first.
 */
export async function searchPlaces(db: DbClient, rawQuery: string, near: LngLat | null, limit: number, now = new Date()): Promise<Place[]> {
  const address = splitAddress(rawQuery);
  if (!address || (!address.locality && !address.postcode)) return searchNames(db, rawQuery, near, limit, now);
  // "12 Wellington St, Cleveland QLD 4163": that address in Cleveland, or failing that the street
  // there, before any other 12 Wellington Street in the country.
  const [located, named] = await Promise.all([findInLocality(db, address, near), searchNames(db, address.name, near, limit, now)]);
  const out = located.map((r) => toPlace(r, near, now));
  for (const p of named) if (!out.some((o) => o.id === p.id)) out.push(p);
  return out.slice(0, limit);
}

const HOUSE_NUMBER = /^(?:\S+\/)?(\d+[a-z]?)\s+/i;

/** Places named like the address (or its street) in the suburb or postcode it gives, best first. */
async function findInLocality(db: DbClient, a: { name: string; locality: string | null; postcode: string | null }, near: LngLat | null): Promise<PlaceRow[]> {
  const full = expandAbbreviations(a.name).toLowerCase();
  // "3/12 Smith Street" is unit 3 at number 12; addresses are mapped by the number on the street.
  const numbered = full.replace(HOUSE_NUMBER, '$1 ');
  const street = full.replace(HOUSE_NUMBER, '');
  const names = [...new Set([full, numbered, street])];
  const rows = (
    await db.query<PlaceRow>(
      `SELECT ${COLUMNS}, 1 AS sim FROM places
       WHERE lower(name) = ANY($1::text[]) AND (lower(suburb) = $2 OR postcode = $3) LIMIT 50`,
      [names, a.locality, a.postcode],
    )
  ).rows;
  const rank = (r: PlaceRow) =>
    (lowerName(r) === street && street !== full ? 2 : 0) + (a.locality && r.suburb?.toLowerCase() !== a.locality ? 1 : 0) + (a.postcode && r.postcode !== a.postcode ? 0.5 : 0);
  const dist = (r: PlaceRow) => (near ? haversineM(near, [r.lon, r.lat]) : 0);
  const sorted = rows.sort((x, y) => rank(x) - rank(y) || dist(x) - dist(y));
  // One street, mapped as several pieces, is one suggestion.
  const kept: PlaceRow[] = [];
  for (const r of sorted) if (!kept.some((k) => sameThing(k, r) || (r.kind === 'street' && lowerName(k) === lowerName(r) && k.suburb === r.suburb))) kept.push(r);
  return kept.slice(0, 3);
}

const lowerName = (r: PlaceRow) => r.name.toLowerCase();

async function searchNames(db: DbClient, rawQuery: string, near: LngLat | null, limit: number, now: Date): Promise<Place[]> {
  const q = expandAbbreviations(rawQuery);
  const lower = q.toLowerCase();
  const escaped = lower.replace(/[%_\\]/g, (m) => `\\${m}`);
  const sim = `greatest(similarity(name, $1), coalesce(similarity(brand, $1), 0)) AS sim`;
  // Nearest first when there is an origin; otherwise the most important places first.
  const order = near ? `point(lon, lat) <-> point(${Number(near[0])}, ${Number(near[1])})` : 'importance DESC';
  // Find the matches first, then sort them. Left to itself the planner walks the point index
  // nearest-first and filters every row, which reads the whole table for rare names.
  const nearestOf = (where: string, n: number, cap = 20_000) =>
    `WITH m AS MATERIALIZED (SELECT ${COLUMNS}, ${sim} FROM places WHERE ${where} LIMIT ${cap}) SELECT * FROM m ORDER BY ${order} LIMIT ${n}`;
  const pools: Array<Promise<{ rows: PlaceRow[] }>> = [
    db.query<PlaceRow>(nearestOf('lower(name) = $2 OR lower(brand) = $2', 100), [q, lower]),
    db.query<PlaceRow>(
      `SELECT ${COLUMNS}, ${sim} FROM places
       WHERE kind IN ('city', 'town', 'suburb') AND name % $1 ORDER BY sim DESC, importance DESC LIMIT 30`,
      [q],
    ),
  ];
  // Short prefixes ("Ma") match too much to sort nationwide; the local pool covers them.
  if (lower.length >= 3) {
    pools.push(
      db.query<PlaceRow>(nearestOf('lower(name) LIKE $2 OR lower(brand) LIKE $2', 100), [q, `${escaped}%`]),
    );
  }
  if (!near) {
    // No origin (a phone without location): fall back to fuzzy matching everywhere. Slower for
    // common words, but it is the only way to catch typos in street and business names.
    pools.push(db.query<PlaceRow>(`SELECT ${COLUMNS}, ${sim} FROM places WHERE name % $1 ORDER BY sim DESC LIMIT 100`, [q]));
  } else {
    // Typos and partial words near the origin: the 30,000 nearest places (a few km in a city, much
    // further in the country), filtered by similarity. A trigram index scan is no help here:
    // "12 Lonsdale Street" shares its trigrams with millions of addresses.
    pools.push(
      db.query<PlaceRow>(
        `WITH b AS MATERIALIZED (SELECT ${COLUMNS}, brand FROM places ORDER BY ${order} LIMIT 30000)
         SELECT ${COLUMNS}, ${sim} FROM b WHERE name % $1 OR brand % $1 OR lower(name) LIKE $2 ORDER BY sim DESC LIMIT 150`,
        [q, `${escaped}%`],
      ),
    );
  }
  const types = categoryTypes(q);
  const category =
    types && near
      ? db.query<PlaceRow>(
          `WITH m AS MATERIALIZED (SELECT ${COLUMNS}, 1 AS sim FROM places WHERE poi_type = ANY($1::text[]))
           SELECT * FROM m ORDER BY point(lon, lat) <-> point($2, $3) LIMIT $4`,
          [types, near[0], near[1], limit * 2],
        )
      : Promise.resolve({ rows: [] as PlaceRow[] });
  const [categoryRows, ...pooled] = await Promise.all([category.then((r) => r.rows), ...pools.map((p) => p.then((r) => r.rows))]);
  const seen = new Set(categoryRows.map((r) => r.id));
  const named = new Map<string, PlaceRow>();
  for (const r of pooled.flat()) if (!seen.has(r.id)) named.set(r.id, r);
  const ranked = [...named.values()]
    .map((r) => ({ r, score: searchScore(r, q, near) }))
    .sort((a, b) => b.score - a.score)
    .map(({ r }) => r);
  const kept: PlaceRow[] = [];
  for (const r of [...categoryRows, ...ranked]) {
    if (kept.length >= limit) break;
    if (!kept.some((k) => sameThing(k, r))) kept.push(r);
  }
  return kept.map((r) => toPlace(r, near, now));
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
