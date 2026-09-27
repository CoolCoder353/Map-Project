import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOB_NAMES, bossQueue, startBoss } from '../../src/lib/queue.js';
import { listJobs } from '../../src/services/ops.js';
import { type TestDb, createTestDb } from '../helpers/db.js';

let t: TestDb;
let boss: PgBoss;
beforeAll(async () => {
  t = await createTestDb();
  boss = await startBoss(t.url);
});
afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await t?.close();
});

describe('job queue', () => {
  it('creates every queue: per-user jobs collapse, the refresh never retries', async () => {
    // pg-boss keeps internal queues of its own ("__pgboss__…").
    const queues = new Map((await boss.getQueues()).filter((q) => !q.name.startsWith('__pgboss')).map((q) => [q.name, q]));
    expect([...queues.keys()].sort()).toEqual([...JOB_NAMES].sort());
    expect(queues.get('process-tracks')).toMatchObject({ policy: 'stately', retryLimit: 3 });
    expect(queues.get('system-sample')).toMatchObject({ policy: 'standard', retryLimit: 3 });
    expect(queues.get('osm-refresh')).toMatchObject({ policy: 'stately', retryLimit: 0, expireInSeconds: 6 * 3600 });
  });

  it('restarting leaves existing queues alone', async () => {
    const before = await boss.getQueues();
    await boss.stop({ graceful: false, timeout: 1000 });
    boss = await startBoss(t.url);
    expect(await boss.getQueues()).toEqual(before);
  });

  it('queues one job per user for track processing', async () => {
    const q = bossQueue(boss);
    const first = await q.send('process-tracks', { userId: 'u1' }, { singletonKey: 'process-tracks:u1' });
    const dup = await q.send('process-tracks', { userId: 'u1' }, { singletonKey: 'process-tracks:u1' });
    const other = await q.send('process-tracks', { userId: 'u2' }, { singletonKey: 'process-tracks:u2' });
    expect(first).toBeTruthy();
    expect(dup).toBeNull();
    expect(other).toBeTruthy();
    expect(await q.send('system-sample', {})).toBeTruthy();
  });

  it('the dashboard’s job view counts queued jobs per queue and filters by state', async () => {
    const view = await listJobs(t.db);
    expect(view.queues.find((q) => q.name === 'process-tracks')).toEqual({ name: 'process-tracks', queued: 2, active: 0, failed: 0 });
    expect(view.queues.every((q) => !q.name.startsWith('__'))).toBe(true);
    expect(view.jobs.length).toBeGreaterThanOrEqual(3);
    expect(view.jobs[0]).toMatchObject({ state: 'created', completedOn: null, retryCount: 0, output: null });
    expect((await listJobs(t.db, 'failed')).jobs).toEqual([]);
  });
});
