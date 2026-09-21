import {
  GraphHopperClient,
  JOB_NAMES,
  MetricsAggregator,
  TokenService,
  bossQueue,
  createLogger,
  createPool,
  metricsWriter,
  migrate,
  opsService,
  startBoss,
} from '@wayfinder/core';
import { loadConfig } from './config.js';
import { instrument, jobHandlers } from './jobs.js';

const config = loadConfig();
const log = createLogger('worker', config.LOG_LEVEL);
const db = createPool(config.DATABASE_URL, 10);
await migrate(db, (m) => log.info(m));
const boss = await startBoss(config.DATABASE_URL);
const metrics = new MetricsAggregator(metricsWriter(db));
metrics.start();

const ctx = {
  db,
  // The worker never signs tokens; a random secret satisfies the interface.
  tokens: new TokenService(crypto.randomUUID() + crypto.randomUUID()),
  graphhopper: new GraphHopperClient(config.GRAPHHOPPER_URL),
  metrics,
  queue: bossQueue(boss),
  log,
  config: { publicWebUrl: '', service: 'worker' as const },
};

const handlers = jobHandlers({
  ctx,
  diskPath: config.DISK_PATH,
  queueDepth: async () => (await opsService.listJobs(db)).queues.reduce((n, q) => n + q.queued, 0),
  refresh: {
    dataDir: config.DATA_DIR,
    pbfUrl: config.OSM_PBF_URL,
    graphhopperJar: config.GRAPHHOPPER_JAR,
    graphhopperConfig: config.GRAPHHOPPER_CONFIG,
    graphhopperHeap: config.GRAPHHOPPER_IMPORT_HEAP,
    planetilerJar: config.PLANETILER_JAR,
    planetilerHeap: config.PLANETILER_HEAP,
    skip: config.OSM_REFRESH_SKIP.split(',').map((s) => s.trim()).filter(Boolean),
  },
  refreshEnabled: config.OSM_REFRESH_ENABLED,
});

for (const name of JOB_NAMES) {
  const handler = instrument(ctx, name, handlers[name]);
  const concurrency = name === 'process-tracks' ? 4 : 1;
  await boss.work<Record<string, unknown>>(name, { batchSize: 1, localConcurrency: concurrency }, async (jobs) => {
    for (const job of jobs) await handler(job.data ?? {});
  });
}

await boss.schedule('system-sample', '* * * * *');
await boss.schedule('metrics-maintenance', '7 * * * *');
await boss.schedule('purge-deleted', '17 3 * * *');
if (config.OSM_REFRESH_CRON && config.OSM_REFRESH_ENABLED) await boss.schedule('osm-refresh', config.OSM_REFRESH_CRON);
else await boss.unschedule('osm-refresh');

// Heartbeat immediately so the dashboard shows the worker as up.
await handlers['system-sample']({}).catch((err) => log.warn({ err }, 'initial system sample failed'));
log.info('worker started');

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await metrics.stop();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
