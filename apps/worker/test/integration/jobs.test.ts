import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetricsAggregator, adminService, createLogger, metricsWriter, opsService, trackService } from '@wayfinder/core';
import { destination } from '@wayfinder/shared';
import { instrument, jobHandlers } from '../../src/jobs.js';
import { type TestDb, createTestDb } from '../../../../packages/core/test/helpers/db.js';
import { FakeQueue } from '../../../../packages/core/test/helpers/fakes.js';
import { makeUser } from '../../../../packages/core/test/helpers/users.js';

let t: TestDb;
const queue = new FakeQueue();
const graphhopper = {
  // Map matching: the worker snaps trips onto roads after processing them.
  async match() {
    return null;
  },
  health: async () => ({ up: true, latencyMs: 3, detail: null }),
  dataDate: async () => '2026-09-01T00:00:00Z',
} as never;

function deps() {
  return {
    ctx: {
      db: t.db,
      tokens: {} as never,
      graphhopper,
      metrics: new MetricsAggregator(metricsWriter(t.db)),
      queue,
      log: createLogger('worker-test', 'silent'),
      config: { publicWebUrl: '', service: 'worker' as const },
    },
    refresh: { dataDir: '/tmp/unused', pbfUrl: 'x', graphhopperJar: 'x', graphhopperConfig: 'x', graphhopperHeap: '1g', planetilerJar: 'x', planetilerHeap: '1g', skip: [] },
    queueDepth: async () => 0,
    diskPath: '/',
  };
}

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

describe('worker job handlers', () => {
  it('processes tracks and rebuilds coverage through the job handlers', async () => {
    const handlers = jobHandlers(deps());
    const u = await makeUser(t.db, 'jobs@example.com');
    const points = Array.from({ length: 120 }, (_, i) => {
      const [lon, lat] = destination([149.2, -35.4], 90, i * 12);
      return { ts: Date.now() - 7200_000 + i * 5000, lon, lat, accuracyM: 7 };
    });
    await trackService.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points });
    queue.take('process-tracks');
    expect(await handlers['process-tracks']({ userId: u.id })).toMatchObject({ tripsTouched: 1 });
    const before = (await t.db.query('SELECT count(*)::int AS n FROM visited_cells WHERE user_id = $1', [u.id])).rows[0].n;
    expect(before).toBeGreaterThan(2);
    // Rebuilding also re-snaps trips onto roads; this fake engine matches nothing.
    expect(await handlers['rebuild-coverage']({ userId: u.id })).toMatchObject({ cells: before, matched: 0, unmatched: 1 });
  });

  it('purge-deleted removes expired data and re-queues users with stale unassigned points', async () => {
    const handlers = jobHandlers(deps());
    const stale = await makeUser(t.db, 'stale@example.com');
    const doomed = await makeUser(t.db, 'doomed@example.com');
    await t.db.query("UPDATE users SET deleted_at = now() - interval '9 days' WHERE id = $1", [doomed.id]);
    await t.db.query(
      `INSERT INTO track_points (user_id, batch_id, source, ts, lon, lat) VALUES ($1, $2, 'background', now() - interval '30 minutes', 149.1, -35.3)`,
      [stale.id, randomUUID()],
    );
    queue.take('process-tracks');
    const result = (await handlers['purge-deleted']({})) as { users: number; trips: number; staleUsers: number };
    expect(result.users).toBe(1);
    expect(result.staleUsers).toBe(1);
    expect(queue.take('process-tracks').map((j) => j.data.userId)).toEqual([stale.id]);
    expect((await t.db.query('SELECT 1 FROM users WHERE id = $1', [doomed.id])).rowCount).toBe(0);
  });

  it('system-sample writes a sample and the worker heartbeat; metrics-maintenance rolls up', async () => {
    const handlers = jobHandlers(deps());
    await handlers['system-sample']({});
    const sample = (await t.db.query('SELECT cpu_pct, graphhopper_up, queue_depth FROM system_samples ORDER BY ts DESC LIMIT 1')).rows[0];
    expect(sample).toMatchObject({ graphhopper_up: true, queue_depth: 0 });
    const health = await opsService.checkHealth(t.db, graphhopper);
    expect(health.services.find((s) => s.name === 'worker')?.up).toBe(true);
    expect(health.osmDataDate).toBe('2026-09-01T00:00:00Z');

    const hist = Array(64).fill(0);
    hist[24] = 5;
    await t.db.query(
      `INSERT INTO metrics_minute (bucket_start, metric, label, count, error_count, sum_ms, max_ms, histogram)
       VALUES (date_trunc('day', now()) - interval '4 hours', 'job', 'process-tracks', 5, 0, 500, 120, $1)`,
      [hist],
    );
    await handlers['metrics-maintenance']({});
    const daily = (await t.db.query("SELECT count(*)::int AS n FROM metrics_daily WHERE metric = 'job'")).rows[0].n;
    expect(daily).toBe(1);
  });

  it('instrument records job metrics and error events', async () => {
    const d = deps();
    const failing = instrument(d.ctx, 'rebuild-coverage', async () => {
      throw new Error('coverage exploded at -35.28123');
    });
    await expect(failing({})).rejects.toThrow('coverage exploded');
    await d.ctx.metrics.flush(true);
    const rows = (await t.db.query("SELECT metric, label, error_count FROM metrics_minute WHERE metric = 'job'")).rows;
    expect(rows.some((r) => r.label === 'rebuild-coverage' && r.error_count === 1)).toBe(true);
    const err = (await t.db.query("SELECT source, message FROM error_events WHERE service = 'worker' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(err.source).toBe('rebuild-coverage');
    // Coordinates are scrubbed before storage.
    expect(err.message).toBe('coverage exploded at [num]');
    const groups = await adminService.listErrorGroups(t.db, { limit: 10 });
    expect(groups[0]).toMatchObject({ service: 'worker', count: 1 });
  });

  it('osm-refresh on a server that can’t build map data records a failed run explaining why', async () => {
    const handlers = jobHandlers({ ...deps(), refreshEnabled: false });
    // A scheduled run has no run id yet; the job creates one.
    const out = (await handlers['osm-refresh']({})) as { runId: string; skipped: boolean };
    expect(out.skipped).toBe(true);
    const run = (await t.db.query('SELECT status, finished_at, log_tail FROM pipeline_runs WHERE id = $1', [out.runId])).rows[0];
    expect(run.status).toBe('failed');
    expect(run.finished_at).not.toBeNull();
    expect(run.log_tail).toMatch(/OSM_REFRESH_ENABLED=false/);
    // A run queued from the dashboard keeps its id.
    const runId = await opsService.createPipelineRun(t.db, 'osm_refresh', null);
    expect(await handlers['osm-refresh']({ runId })).toEqual({ runId, skipped: true });
  });
});
