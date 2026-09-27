import { JOB_NAMES, type CoreContext, type JobName } from '@wayfinder/core';
import { describe, expect, it, vi } from 'vitest';
import { registerJobs } from '../../src/register.js';

function fakeBoss() {
  const workers = new Map<string, { options: unknown; fn: (jobs: Array<{ data: unknown }>) => Promise<void> }>();
  return {
    workers,
    work: vi.fn(async (name: string, options: unknown, fn: (jobs: Array<{ data: unknown }>) => Promise<void>) => {
      workers.set(name, { options, fn });
      return name;
    }),
    schedule: vi.fn(async (_name: string, _cron: string) => undefined),
    unschedule: vi.fn(async (_name: string) => undefined),
  };
}

const ctx = {
  metrics: { time: (_m: string, _l: string, fn: () => Promise<unknown>) => fn() },
  log: { error: vi.fn() },
  db: { query: vi.fn(async () => ({ rows: [] })) },
} as unknown as CoreContext;

const handlers = () => Object.fromEntries(JOB_NAMES.map((n) => [n, vi.fn(async () => ({ ran: n }))])) as unknown as Record<JobName, ReturnType<typeof vi.fn>>;

describe('worker job registration', () => {
  it('works every job, four tracks at a time and the rest one at a time', async () => {
    const boss = fakeBoss();
    const h = handlers();
    await registerJobs(boss as never, ctx, h as never, { cron: '0 3 2 * *', enabled: true });
    expect([...boss.workers.keys()].sort()).toEqual([...JOB_NAMES].sort());
    expect(boss.workers.get('process-tracks')!.options).toEqual({ batchSize: 1, localConcurrency: 4 });
    expect(boss.workers.get('osm-refresh')!.options).toEqual({ batchSize: 1, localConcurrency: 1 });
    await boss.workers.get('process-tracks')!.fn([{ data: { userId: 'u1' } }, { data: null }]);
    expect(h['process-tracks'].mock.calls).toEqual([[{ userId: 'u1' }], [{}]]);
  });

  it('schedules sampling, metrics roll-up, purges and the monthly refresh', async () => {
    const boss = fakeBoss();
    await registerJobs(boss as never, ctx, handlers() as never, { cron: '0 3 2 * *', enabled: true });
    expect(boss.schedule.mock.calls).toEqual([
      ['system-sample', '* * * * *'],
      ['metrics-maintenance', '7 * * * *'],
      ['purge-deleted', '17 3 * * *'],
      ['osm-refresh', '0 3 2 * *'],
    ]);
    expect(boss.unschedule).not.toHaveBeenCalled();
  });

  it('removes the refresh schedule where refreshes are off or have no cron', async () => {
    for (const refresh of [{ cron: '0 3 2 * *', enabled: false }, { cron: '', enabled: true }]) {
      const boss = fakeBoss();
      await registerJobs(boss as never, ctx, handlers() as never, refresh);
      expect(boss.schedule.mock.calls.map((c) => c[0])).not.toContain('osm-refresh');
      expect(boss.unschedule).toHaveBeenCalledWith('osm-refresh');
    }
  });

  it('lets a failing job fail so pg-boss retries it', async () => {
    const boss = fakeBoss();
    const h = handlers();
    h['rebuild-coverage'].mockRejectedValueOnce(new Error('boom'));
    await registerJobs(boss as never, ctx, h as never, { cron: '', enabled: false });
    await expect(boss.workers.get('rebuild-coverage')!.fn([{ data: { userId: 'u1' } }])).rejects.toThrow('boom');
  });
});
