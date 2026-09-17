import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { type Db, placeService, withTransaction } from '@wayfinder/core';
import { type GeoJsonFeature, type PlaceRecord, featureToPlaces, streetKey } from './osm-places.js';

const BATCH = 5000;

/**
 * Load an `osmium export -f geojsonseq` file into a staging table, then atomically swap it
 * in as `places`. Returns the number of places imported.
 */
export async function importPlacesFromGeoJsonSeq(db: Db, path: string, log: (m: string) => void = () => undefined): Promise<number> {
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
    const line = rawLine.replace(/^\x1e/, '').trim(); // RFC 8142 record separator
    if (!line) continue;
    let feature: GeoJsonFeature;
    try {
      feature = JSON.parse(line) as GeoJsonFeature;
    } catch {
      continue;
    }
    for (const place of featureToPlaces(feature)) {
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

  await db.query('CREATE INDEX places_staging_name_trgm_idx ON places_staging USING gin (name gin_trgm_ops)');
  await db.query('CREATE INDEX places_staging_r7_idx ON places_staging (r7)');
  await db.query('CREATE INDEX places_staging_r9_idx ON places_staging (r9)');
  await db.query('CREATE INDEX places_staging_category_r7_idx ON places_staging (category, r7) WHERE category IS NOT NULL');
  await withTransaction(db, async (tx) => {
    await tx.query('DROP TABLE places');
    await tx.query('ALTER TABLE places_staging RENAME TO places');
    await tx.query('ALTER INDEX places_staging_name_trgm_idx RENAME TO places_name_trgm_idx');
    await tx.query('ALTER INDEX places_staging_r7_idx RENAME TO places_r7_idx');
    await tx.query('ALTER INDEX places_staging_r9_idx RENAME TO places_r9_idx');
    await tx.query('ALTER INDEX places_staging_category_r7_idx RENAME TO places_category_r7_idx');
    await tx.query('ALTER INDEX places_staging_pkey RENAME TO places_pkey');
  });
  log(`places import complete: ${total}`);
  return total;
}
