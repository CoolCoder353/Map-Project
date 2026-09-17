import { PgBoss } from 'pg-boss';
import type { JobName, JobQueue } from '../services/context.js';

export const JOB_NAMES: JobName[] = [
  'process-tracks',
  'rebuild-coverage',
  'purge-deleted',
  'system-sample',
  'metrics-maintenance',
  'osm-refresh',
];

/** Per-user jobs collapse to one queued job per user (stately + singletonKey). */
const STATELY: JobName[] = ['process-tracks', 'rebuild-coverage', 'osm-refresh'];

export async function startBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err: unknown) => console.error('pg-boss error', err));
  await boss.start();
  const existing = new Set((await boss.getQueues()).map((q) => q.name));
  for (const name of JOB_NAMES) {
    if (!existing.has(name)) {
      await boss.createQueue(name, {
        policy: STATELY.includes(name) ? 'stately' : 'standard',
        retryLimit: name === 'osm-refresh' ? 0 : 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: name === 'osm-refresh' ? 6 * 3600 : 15 * 60,
      });
    }
  }
  return boss;
}

export function bossQueue(boss: PgBoss): JobQueue {
  return {
    send: (name, data, options) => boss.send(name, data, options?.singletonKey ? { singletonKey: options.singletonKey } : {}),
  };
}
