import {
  GraphHopperClient,
  MetricsAggregator,
  TokenService,
  bossQueue,
  createLogger,
  createPool,
  metricsWriter,
  migrate,
  startBoss,
} from '@wayfinder/core';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { reloadingTileArchive } from './plugins/tiles.js';

const config = loadConfig();
const log = createLogger('api', config.LOG_LEVEL);
const db = createPool(config.DATABASE_URL, 20);
await migrate(db, (m) => log.info(m));
const boss = await startBoss(config.DATABASE_URL);
const metrics = new MetricsAggregator(metricsWriter(db));
metrics.start();

const tiles = reloadingTileArchive(config.PMTILES_PATH);
if (!(await tiles.available())) log.warn({ path: config.PMTILES_PATH }, 'PMTiles archive not found; tiles return 503 until the data pipeline builds it');

const app = await buildApp({
  ctx: {
    db,
    tokens: new TokenService(config.JWT_SECRET),
    graphhopper: new GraphHopperClient(config.GRAPHHOPPER_URL),
    metrics,
    queue: bossQueue(boss),
    log,
    config: { publicWebUrl: config.PUBLIC_WEB_URL, service: 'api' },
  },
  config,
  tiles,
  jobs: { retry: async (name, id) => void (await boss.retry(name, id)) },
});

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down');
  await app.close();
  await metrics.stop();
  await boss.stop({ graceful: true });
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
