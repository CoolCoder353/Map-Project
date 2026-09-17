import type { Db } from '../db/pool.js';
import type { GraphHopperClient } from '../lib/graphhopper.js';
import type { Logger } from '../lib/logger.js';
import type { MetricsAggregator } from '../lib/metrics.js';
import type { TokenService } from '../lib/tokens.js';

export type JobName =
  | 'process-tracks'
  | 'rebuild-coverage'
  | 'purge-deleted'
  | 'system-sample'
  | 'metrics-maintenance'
  | 'osm-refresh';

export interface JobQueue {
  send(name: JobName, data: Record<string, unknown>, options?: { singletonKey?: string }): Promise<string | null>;
}

/** Everything services need; built once per process (api or worker). */
export interface CoreContext {
  db: Db;
  tokens: TokenService;
  graphhopper: GraphHopperClient;
  metrics: MetricsAggregator;
  queue: JobQueue;
  log: Logger;
  config: {
    publicWebUrl: string;
    service: 'api' | 'worker' | 'cli';
  };
}
