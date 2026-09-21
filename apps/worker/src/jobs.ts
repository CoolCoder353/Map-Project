import {
  type CoreContext,
  type JobName,
  adminService,
  opsService,
  recordErrorEvent,
  trackService,
} from '@wayfinder/core';
import type { RefreshConfig } from './pipeline/refresh.js';
import { runOsmRefresh } from './pipeline/refresh.js';

export interface WorkerDeps {
  ctx: CoreContext;
  refresh: RefreshConfig;
  /** false where the server can't build map data itself; refreshes are refused. */
  refreshEnabled?: boolean;
  queueDepth: () => Promise<number>;
  diskPath: string;
}

type Handler = (data: Record<string, unknown>) => Promise<unknown>;

export function jobHandlers(deps: WorkerDeps): Record<JobName, Handler> {
  const { db, graphhopper, queue } = deps.ctx;
  return {
    'process-tracks': async (data) => trackService.processUserTracks(db, String(data.userId)),
    'rebuild-coverage': async (data) => trackService.rebuildCoverage(db, String(data.userId)),
    'purge-deleted': async () => {
      const purged = await adminService.purgeDeleted(db);
      // Points left unassigned (e.g. the tail of a trip when tracking stopped) get a final pass.
      const stale = await db.query<{ user_id: string }>(
        "SELECT DISTINCT user_id FROM track_points WHERE trip_id IS NULL AND ts < now() - interval '15 minutes'",
      );
      for (const r of stale.rows) await queue.send('process-tracks', { userId: r.user_id }, { singletonKey: `process-tracks:${r.user_id}` });
      return { ...purged, staleUsers: stale.rowCount };
    },
    'system-sample': async () => opsService.sampleSystem(db, graphhopper, deps.queueDepth, deps.diskPath),
    'metrics-maintenance': async () => adminService.maintainMetrics(db),
    'osm-refresh': async (data) => {
      let runId = typeof data.runId === 'string' ? data.runId : null;
      if (!runId) runId = await opsService.createPipelineRun(db, 'osm_refresh', null); // scheduled run
      if (deps.refreshEnabled === false) {
        await opsService.updatePipelineRun(db, runId, {
          status: 'failed',
          finished: true,
          logTail: 'Map refreshes are turned off on this server (OSM_REFRESH_ENABLED=false): it is too small to build map data. Build the data on a larger machine and copy it in; see docs/deploy-small-server.md.',
        });
        return { runId, skipped: true };
      }
      await runOsmRefresh(db, runId, deps.refresh);
      return { runId };
    },
  };
}

/** Wrap a handler with metrics and error-event recording. */
export function instrument(ctx: CoreContext, name: JobName, handler: Handler): Handler {
  return async (data) => {
    try {
      return await ctx.metrics.time('job', name, () => handler(data));
    } catch (err) {
      ctx.log.error({ err, job: name }, 'job failed');
      await recordErrorEvent(ctx.db, { service: 'worker', source: name, error: err }).catch(() => undefined);
      throw err;
    }
  };
}
