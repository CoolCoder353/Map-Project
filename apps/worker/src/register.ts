/** Wires job handlers and schedules into pg-boss. Kept apart from main.ts so tests can check it. */
import { type CoreContext, JOB_NAMES, type JobName } from '@wayfinder/core';
import type { PgBoss } from 'pg-boss';
import { instrument } from './jobs.js';

type Boss = Pick<PgBoss, 'work' | 'schedule' | 'unschedule'>;
type Handler = (data: Record<string, unknown>) => Promise<unknown>;

export const SCHEDULES: Array<[JobName, string]> = [
  ['system-sample', '* * * * *'],
  ['metrics-maintenance', '7 * * * *'],
  ['purge-deleted', '17 3 * * *'],
];

export async function registerJobs(
  boss: Boss,
  ctx: CoreContext,
  handlers: Record<JobName, Handler>,
  refresh: { cron: string; enabled: boolean },
): Promise<void> {
  for (const name of JOB_NAMES) {
    const handler = instrument(ctx, name, handlers[name]);
    // Track processing is per user and the most frequent; the rest run one at a time.
    const concurrency = name === 'process-tracks' ? 4 : 1;
    await boss.work<Record<string, unknown>>(name, { batchSize: 1, localConcurrency: concurrency }, async (jobs) => {
      for (const job of jobs) await handler(job.data ?? {});
    });
  }
  for (const [name, cron] of SCHEDULES) await boss.schedule(name, cron);
  if (refresh.cron && refresh.enabled) await boss.schedule('osm-refresh', refresh.cron);
  else await boss.unschedule('osm-refresh');
}
