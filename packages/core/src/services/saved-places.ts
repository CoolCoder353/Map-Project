import { type LngLat, MAX_SAVED_PLACES, type Place, SAVED_PLACE_KIND, type SavedPlace, type SavedPlaceSave, haversineM } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { conflict, notFound } from '../lib/errors.js';

interface Row {
  id: string;
  name: string;
  description: string;
  lon: number;
  lat: number;
  created_at: Date;
}

const toSaved = (r: Row): SavedPlace => ({ id: r.id, name: r.name, description: r.description, location: [r.lon, r.lat], createdAt: r.created_at.toISOString() });

export async function listSavedPlaces(db: DbClient, userId: string): Promise<SavedPlace[]> {
  const r = await db.query<Row>('SELECT id, name, description, lon, lat, created_at FROM saved_places WHERE user_id = $1 ORDER BY lower(name)', [userId]);
  return r.rows.map(toSaved);
}

/** Saves [p] under its name; a place already saved under that name (any capitals) is moved. */
export async function saveSavedPlace(db: DbClient, userId: string, p: SavedPlaceSave): Promise<SavedPlace> {
  const existing = await db.query<{ id: string }>('SELECT id FROM saved_places WHERE user_id = $1 AND lower(name) = lower($2)', [userId, p.name]);
  if (existing.rows.length === 0) {
    const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM saved_places WHERE user_id = $1', [userId]);
    if (count.rows[0]!.n >= MAX_SAVED_PLACES) throw conflict(`You can save up to ${MAX_SAVED_PLACES} places. Remove one in Settings first.`);
  }
  const r = await db.query<Row>(
    `INSERT INTO saved_places (user_id, name, description, lon, lat) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, lon = EXCLUDED.lon, lat = EXCLUDED.lat, updated_at = now()
     RETURNING id, name, description, lon, lat, created_at`,
    [userId, p.name, p.description, p.location[0], p.location[1]],
  );
  return toSaved(r.rows[0]!);
}

export async function deleteSavedPlace(db: DbClient, userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Saved place not found');
  const r = await db.query('DELETE FROM saved_places WHERE id = $1 AND user_id = $2', [id, userId]);
  if (r.rowCount === 0) throw notFound('Saved place not found');
}

/**
 * The person's saved places whose name starts with what they typed ("ho" finds Home), as search
 * results to put before everything else.
 */
export async function matchingSavedPlaces(db: DbClient, userId: string, query: string, near: LngLat | null): Promise<Place[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const r = await db.query<Row>(
    `SELECT id, name, description, lon, lat, created_at FROM saved_places
     WHERE user_id = $1 AND starts_with(lower(name), $2) ORDER BY length(name), lower(name) LIMIT 5`,
    [userId, q],
  );
  return r.rows.map((row) => ({
    id: `saved:${row.id}`,
    name: row.name,
    kind: SAVED_PLACE_KIND,
    description: ['Saved place', row.description].filter(Boolean).join(' · '),
    typeLabel: 'Saved place',
    ...(row.description ? { context: row.description } : {}),
    location: [row.lon, row.lat],
    ...(near ? { distanceM: haversineM(near, [row.lon, row.lat]) } : {}),
  }));
}
