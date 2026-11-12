/**
 * Import Queensland's surveyed speed limit signs (see pipeline/speed-signs.ts), once: the survey
 * isn't updated, so this needn't run again unless the speed_signs table is lost.
 *
 *   docker compose run --rm --no-deps worker node dist/speed-signs-cli.js
 */
import { createPool, migrate } from '@wayfinder/core';
import { loadConfig } from './config.js';
import { downloadSpeedSigns } from './pipeline/speed-signs.js';

const c = loadConfig();
const db = createPool(c.DATABASE_URL, 2);
try {
  await migrate(db);
  const n = await downloadSpeedSigns(db, (url) => fetch(url, { signal: AbortSignal.timeout(120_000) }), console.log);
  console.log(`done: ${n} signs`);
} finally {
  await db.end();
}
