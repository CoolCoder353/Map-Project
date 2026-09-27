/**
 * Run a map data refresh by hand, optionally only some steps, e.g. to rebuild search data
 * after an importer change without rebuilding the graph and tiles:
 *
 *   docker compose run --rm --no-deps worker node dist/refresh-cli.js places
 *
 * With no arguments every step runs (like the monthly job). Steps: download, graph, tiles, places.
 * The run appears in the dashboard's pipeline history like any other.
 */
import { createPool, opsService } from '@wayfinder/core';
import { loadConfig } from './config.js';
import { runOsmRefresh, stepsToSkip } from './pipeline/refresh.js';

let skip: string[];
try {
  skip = stepsToSkip(process.argv.slice(2), process.env.OSM_REFRESH_SKIP ?? '');
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const c = loadConfig();
const db = createPool(c.DATABASE_URL, 2);
const runId = await opsService.createPipelineRun(db, 'osm_refresh', null);
console.log(`run ${runId}${skip.length ? ` (skipping ${skip.join(', ')})` : ''}`);
try {
  await runOsmRefresh(
    db,
    runId,
    {
      dataDir: c.DATA_DIR,
      pbfUrl: c.OSM_PBF_URL,
      graphhopperJar: c.GRAPHHOPPER_JAR,
      graphhopperConfig: c.GRAPHHOPPER_CONFIG,
      graphhopperHeap: c.GRAPHHOPPER_IMPORT_HEAP,
      planetilerJar: c.PLANETILER_JAR,
      planetilerHeap: c.PLANETILER_HEAP,
      skip,
    },
  );
  console.log('done — see Admin → Jobs & data for the log');
} finally {
  await db.end();
}
