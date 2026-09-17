import os from 'node:os';
import { statfs } from 'node:fs/promises';
import type { HealthResponse } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import type { GraphHopperClient } from '../lib/graphhopper.js';
import { getAppState, setAppState } from './admin.js';

export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
export const OSM_DATA_DATE_KEY = 'osm.dataDate';

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; err: string | null }> {
  const start = performance.now();
  try {
    await fn();
    return { ok: true, ms: performance.now() - start, err: null };
  } catch (e) {
    return { ok: false, ms: performance.now() - start, err: (e as Error).message };
  }
}

export async function checkHealth(db: DbClient, graphhopper: GraphHopperClient): Promise<HealthResponse> {
  const [dbRes, gh] = await Promise.all([timed(() => db.query('SELECT 1')), graphhopper.health()]);
  const services: HealthResponse['services'] = [
    { name: 'api', up: true, latencyMs: 0, detail: null },
    { name: 'database', up: dbRes.ok, latencyMs: dbRes.ok ? dbRes.ms : null, detail: dbRes.err },
    { name: 'graphhopper', up: gh.up, latencyMs: gh.latencyMs, detail: gh.detail },
  ];
  let osmDataDate: string | null = null;
  let system: HealthResponse['system'] = null;
  if (dbRes.ok) {
    const hb = await getAppState<{ at: string }>(db, WORKER_HEARTBEAT_KEY);
    const ageS = hb ? (Date.now() - hb.updatedAt.getTime()) / 1000 : null;
    services.push({
      name: 'worker',
      up: ageS !== null && ageS < 180,
      latencyMs: null,
      detail: ageS === null ? 'No heartbeat yet' : `Last heartbeat ${Math.round(ageS)} s ago`,
    });
    osmDataDate = (await getAppState<string>(db, OSM_DATA_DATE_KEY))?.value ?? null;
    const s = (
      await db.query<{
        ts: Date;
        cpu_pct: number;
        mem_used_bytes: string;
        mem_total_bytes: string;
        disk_used_bytes: string;
        disk_total_bytes: string;
      }>('SELECT * FROM system_samples ORDER BY ts DESC LIMIT 1')
    ).rows[0];
    if (s) {
      system = {
        ts: s.ts.toISOString(),
        cpuPct: s.cpu_pct,
        memUsedBytes: Number(s.mem_used_bytes),
        memTotalBytes: Number(s.mem_total_bytes),
        diskUsedBytes: Number(s.disk_used_bytes),
        diskTotalBytes: Number(s.disk_total_bytes),
      };
    }
  } else {
    services.push({ name: 'worker', up: false, latencyMs: null, detail: 'Database unavailable' });
  }
  if (!osmDataDate && gh.up) osmDataDate = await graphhopper.dataDate();
  return { services, osmDataDate, system };
}

let lastCpu = os.cpus().map((c) => c.times);

function cpuPercent(): number {
  const now = os.cpus().map((c) => c.times);
  let idle = 0;
  let total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? t;
    const dIdle = t.idle - p.idle;
    const dTotal = t.user + t.nice + t.sys + t.irq + t.idle - (p.user + p.nice + p.sys + p.irq + p.idle);
    idle += dIdle;
    total += dTotal;
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

/** Record host stats, service reachability and queue depth; also the worker heartbeat. */
export async function sampleSystem(
  db: DbClient,
  graphhopper: GraphHopperClient,
  queueDepth: () => Promise<number>,
  diskPath = '/',
): Promise<void> {
  const fsStats = await statfs(diskPath);
  const diskTotal = fsStats.blocks * fsStats.bsize;
  const diskUsed = diskTotal - fsStats.bavail * fsStats.bsize;
  const gh = await graphhopper.health();
  const depth = await queueDepth().catch(() => -1);
  await db.query(
    `INSERT INTO system_samples (ts, cpu_pct, mem_used_bytes, mem_total_bytes, disk_used_bytes, disk_total_bytes, db_up, graphhopper_up, queue_depth)
     VALUES (date_trunc('minute', now()), $1, $2, $3, $4, $5, true, $6, $7)
     ON CONFLICT (ts) DO UPDATE SET cpu_pct = EXCLUDED.cpu_pct, mem_used_bytes = EXCLUDED.mem_used_bytes,
       disk_used_bytes = EXCLUDED.disk_used_bytes, graphhopper_up = EXCLUDED.graphhopper_up, queue_depth = EXCLUDED.queue_depth`,
    [cpuPercent(), os.totalmem() - os.freemem(), os.totalmem(), diskUsed, diskTotal, gh.up, depth],
  );
  await setAppState(db, WORKER_HEARTBEAT_KEY, { at: new Date().toISOString() });
}

export async function listSystemSamples(db: DbClient, hours = 24) {
  const rows = (
    await db.query<{ ts: Date; cpu_pct: number; mem_used_bytes: string; disk_used_bytes: string; queue_depth: number }>(
      `SELECT ts, cpu_pct, mem_used_bytes, disk_used_bytes, queue_depth FROM system_samples
       WHERE ts > now() - make_interval(hours => $1) ORDER BY ts`,
      [hours],
    )
  ).rows;
  return rows.map((r) => ({
    ts: r.ts.toISOString(),
    cpuPct: r.cpu_pct,
    memUsedBytes: Number(r.mem_used_bytes),
    diskUsedBytes: Number(r.disk_used_bytes),
    queueDepth: r.queue_depth,
  }));
}

export interface PipelineRunRow {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  started_at: Date;
  finished_at: Date | null;
  osm_data_date: string | null;
  log_tail: string;
}

export async function listPipelineRuns(db: DbClient) {
  const rows = (await db.query<PipelineRunRow>('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 50')).rows;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    osmDataDate: r.osm_data_date,
    logTail: r.log_tail,
  }));
}

export async function createPipelineRun(db: DbClient, kind: string, requestedBy: string | null): Promise<string> {
  const active = await db.query("SELECT 1 FROM pipeline_runs WHERE status IN ('queued', 'running') AND kind = $1", [kind]);
  if ((active.rowCount ?? 0) > 0) throw Object.assign(new Error('A refresh is already queued or running'), { code: 'busy' });
  const r = await db.query<{ id: string }>(
    'INSERT INTO pipeline_runs (kind, requested_by) VALUES ($1, $2) RETURNING id',
    [kind, requestedBy],
  );
  return r.rows[0]!.id;
}

export async function updatePipelineRun(
  db: DbClient,
  id: string,
  patch: { status?: PipelineRunRow['status']; logTail?: string; osmDataDate?: string | null; finished?: boolean },
): Promise<void> {
  await db.query(
    `UPDATE pipeline_runs SET
       status = coalesce($2, status),
       log_tail = coalesce($3, log_tail),
       osm_data_date = coalesce($4, osm_data_date),
       finished_at = CASE WHEN $5 THEN now() ELSE finished_at END
     WHERE id = $1`,
    [id, patch.status ?? null, patch.logTail?.slice(-8000) ?? null, patch.osmDataDate ?? null, patch.finished ?? false],
  );
}

/** Queue overview and recent jobs straight from pg-boss tables. */
export async function listJobs(db: DbClient, state?: string) {
  const exists = (await db.query("SELECT to_regclass('pgboss.job') AS t")).rows[0] as { t: string | null };
  if (!exists.t) return { queues: [], jobs: [] };
  const queues = (
    await db.query<{ name: string; queued: string; active: string; failed: string }>(
      `SELECT name,
              count(*) FILTER (WHERE state IN ('created', 'retry')) AS queued,
              count(*) FILTER (WHERE state = 'active') AS active,
              count(*) FILTER (WHERE state = 'failed') AS failed
       FROM pgboss.job WHERE name NOT LIKE '\\_\\_%' GROUP BY name ORDER BY name`,
    )
  ).rows;
  const jobs = (
    await db.query<{ id: string; name: string; state: string; created_on: Date; completed_on: Date | null; retry_count: number; output: unknown }>(
      `SELECT id, name, state, created_on, completed_on, retry_count, output FROM pgboss.job
       WHERE ($1::text IS NULL OR state::text = $1) AND name NOT LIKE '\\_\\_%'
       ORDER BY created_on DESC LIMIT 200`,
      [state ?? null],
    )
  ).rows;
  return {
    queues: queues.map((q) => ({ name: q.name, queued: Number(q.queued), active: Number(q.active), failed: Number(q.failed) })),
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      state: j.state,
      createdOn: j.created_on.toISOString(),
      completedOn: j.completed_on ? j.completed_on.toISOString() : null,
      retryCount: j.retry_count,
      output: j.output ?? null,
    })),
  };
}
