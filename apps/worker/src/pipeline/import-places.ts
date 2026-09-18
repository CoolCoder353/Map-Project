import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { type Db, placeService, withTransaction } from '@wayfinder/core';
import type { BoundaryIndex } from './boundaries.js';
import { type GeoJsonFeature, type PlaceRecord, featureToPlaces, streetKey } from './osm-places.js';

const BATCH = 5000;

/** Where a place is: tagged address first, then the boundary it lies in, then addr:city. */
function locate(place: PlaceRecord, boundaries: BoundaryIndex | null): PlaceRecord {
  const p: [number, number] = [place.lon, place.lat];
  const settlement = place.kind === 'city' || place.kind === 'town' || place.kind === 'suburb';
  return {
    ...place,
    state: place.state ?? boundaries?.state(p) ?? null,
    suburb: settlement ? place.suburb : (place.suburb ?? boundaries?.suburb(p) ?? place.cityTag ?? null),
  };
}

/**
 * Load an `osmium export -f geojsonseq` file into a staging table, fill in where each place is,
 * then atomically swap it in as `places`. Returns the number of places imported.
 */
export async function importPlacesFromGeoJsonSeq(
  db: Db,
  path: string,
  log: (m: string) => void = () => undefined,
  boundaries: BoundaryIndex | null = null,
): Promise<number> {
  await db.query('DROP TABLE IF EXISTS places_staging');
  await db.query('CREATE TABLE places_staging (LIKE places INCLUDING DEFAULTS)');
  await db.query('ALTER TABLE places_staging ADD PRIMARY KEY (id)');

  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  const seenStreets = new Set<string>();
  let batch: PlaceRecord[] = [];
  let total = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const unique = [...new Map(batch.map((p) => [p.id, p])).values()];
    await placeService.upsertPlaces(db, unique, 'places_staging');
    total += unique.length;
    batch = [];
    if (total % 100_000 < BATCH) log(`imported ${total} places`);
  };
  for await (const rawLine of rl) {
    const RECORD_SEPARATOR = String.fromCharCode(0x1e); // RFC 8142 GeoJSON text sequences
    const line = (rawLine.startsWith(RECORD_SEPARATOR) ? rawLine.slice(1) : rawLine).trim();
    if (!line) continue;
    let feature: GeoJsonFeature;
    try {
      feature = JSON.parse(line) as GeoJsonFeature;
    } catch {
      continue;
    }
    for (const found of featureToPlaces(feature)) {
      const place = locate(found, boundaries);
      const key = streetKey(place);
      if (key) {
        if (seenStreets.has(key)) continue;
        seenStreets.add(key);
      }
      batch.push(place);
    }
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  await db.query('CREATE INDEX places_staging_point_idx ON places_staging USING gist (point(lon, lat))');
  await fillLocation(db, log);

  await db.query('CREATE INDEX places_staging_name_trgm_idx ON places_staging USING gin (name gin_trgm_ops)');
  await db.query('CREATE INDEX places_staging_r7_idx ON places_staging (r7)');
  await db.query('CREATE INDEX places_staging_r9_idx ON places_staging (r9)');
  await db.query('CREATE INDEX places_staging_category_r7_idx ON places_staging (category, r7) WHERE category IS NOT NULL');
  await db.query('CREATE INDEX places_staging_brand_trgm_idx ON places_staging USING gin (brand gin_trgm_ops) WHERE brand IS NOT NULL');
  await db.query('CREATE INDEX places_staging_poi_type_idx ON places_staging (poi_type) WHERE poi_type IS NOT NULL');
  const indexes = ['name_trgm', 'r7', 'r9', 'category_r7', 'point', 'brand_trgm', 'poi_type'];
  await withTransaction(db, async (tx) => {
    await tx.query('DROP TABLE places');
    await tx.query('ALTER TABLE places_staging RENAME TO places');
    for (const i of indexes) await tx.query(`ALTER INDEX places_staging_${i}_idx RENAME TO places_${i}_idx`);
    await tx.query('ALTER INDEX places_staging_pkey RENAME TO places_pkey');
  });
  log(`places import complete: ${total}`);
  return total;
}

/**
 * Fill what the boundaries could not: the nearest settlement (within ~5 km) as the suburb, the
 * postcode most of a suburb's addresses use, and drop settlements mapped twice (a node plus
 * an area) in favour of the node.
 */
async function fillLocation(db: Db, log: (m: string) => void) {
  await db.query(`DROP TABLE IF EXISTS settlements_tmp`);
  await db.query(
    `CREATE TABLE settlements_tmp AS SELECT name, state, lon, lat FROM places_staging WHERE kind IN ('suburb', 'town', 'city')`,
  );
  await db.query('CREATE INDEX settlements_tmp_point_idx ON settlements_tmp USING gist (point(lon, lat))');
  // 0.05° is ~5 km; farther than that the nearest settlement says little about where a place is.
  const nearest = await db.query(
    `WITH n AS (
       SELECT q.id, s.name, s.state
       FROM places_staging q
       CROSS JOIN LATERAL (
         SELECT name, state, point(lon, lat) <-> point(q.lon, q.lat) AS d
         FROM settlements_tmp ORDER BY point(lon, lat) <-> point(q.lon, q.lat) LIMIT 1
       ) s
       WHERE q.suburb IS NULL AND q.kind IN ('street', 'address', 'poi') AND s.d < 0.05
     )
     UPDATE places_staging p SET suburb = n.name, state = coalesce(p.state, n.state)
     FROM n WHERE p.id = n.id`,
  );
  log(`suburb from nearest settlement: ${nearest.rowCount ?? 0}`);
  await db.query('DROP TABLE settlements_tmp');

  const postcodes = await db.query(
    `UPDATE places_staging p SET postcode = pc.postcode
     FROM (
       SELECT suburb, state, mode() WITHIN GROUP (ORDER BY postcode) AS postcode
       FROM places_staging
       WHERE postcode ~ '^[0-9]{4}$' AND suburb IS NOT NULL
       GROUP BY suburb, state
     ) pc
     WHERE p.postcode IS NULL AND p.suburb = pc.suburb AND p.state IS NOT DISTINCT FROM pc.state`,
  );
  log(`postcode from suburb: ${postcodes.rowCount ?? 0}`);

  const dupes = await db.query(
    `DELETE FROM places_staging a USING places_staging b
     WHERE a.kind IN ('city', 'town', 'suburb') AND b.kind = a.kind AND b.name = a.name AND b.id <> a.id
       AND a.state IS NOT DISTINCT FROM b.state
       AND b.id LIKE 'n%' AND a.id NOT LIKE 'n%'
       AND abs(a.lon - b.lon) < 0.5 AND abs(a.lat - b.lat) < 0.5`,
  );
  log(`duplicate settlements removed: ${dupes.rowCount ?? 0}`);
}
