/** Import an osmium GeoJSONSeq export into `places` (dev helper): import-places <file.geojsonseq> */
import { createPool, migrate } from '@wayfinder/core';
import { importPlacesFromGeoJsonSeq } from './import-places.js';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... import-places <file.geojsonseq>');
  process.exit(1);
}
const db = createPool(process.env.DATABASE_URL, 2);
await migrate(db);
await importPlacesFromGeoJsonSeq(db, file, console.log);
await db.end();
