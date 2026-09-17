import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { useIsAdmin, useJobs, usePipelineRuns } from '../hooks';
import { PageHeader, QueryState, StatusPill } from './common';

const JOB_LABEL: Record<string, string> = {
  'process-tracks': 'Process uploaded tracks',
  'rebuild-coverage': 'Rebuild coverage',
  'purge-deleted': 'Purge deleted data',
  'system-sample': 'Sample system stats',
  'metrics-maintenance': 'Roll up metrics',
  'osm-refresh': 'OSM data refresh',
};

export function JobsPage() {
  const isAdmin = useIsAdmin();
  const [state, setState] = useState('failed');
  const jobs = useJobs(state || undefined);
  const runs = usePipelineRuns();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  const retry = useMutation({
    mutationFn: (j: { name: string; id: string }) => api(`/api/admin/jobs/${j.name}/${j.id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast('Job queued for retry.');
      void qc.invalidateQueries({ queryKey: ['admin', 'jobs'] });
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const refresh = useMutation({
    mutationFn: (confirm: string) => api('/api/admin/pipeline/refresh', { method: 'POST', body: { confirm } }),
    onSuccess: () => {
      setConfirmRefresh(false);
      toast('Data refresh queued. It takes one to two hours.');
      void qc.invalidateQueries({ queryKey: ['admin', 'pipeline'] });
    },
  });
  const active = runs.data?.items.some((r) => r.status === 'queued' || r.status === 'running');

  return (
    <>
      <PageHeader title="Jobs & data" description="Background work and the OpenStreetMap data pipeline." />
      <section className="admin-section">
        <h2>Queues</h2>
        <QueryState isLoading={jobs.isLoading} error={jobs.error}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col" className="num-col">Waiting</th>
                <th scope="col" className="num-col">Running</th>
                <th scope="col" className="num-col">Failed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data?.queues.map((q) => (
                <tr key={q.name}>
                  <td>{JOB_LABEL[q.name] ?? q.name}</td>
                  <td className="num-col num">{q.queued}</td>
                  <td className="num-col num">{q.active}</td>
                  <td className="num-col num">{q.failed ? <span className="badge badge-danger">{q.failed}</span> : 0}</td>
                </tr>
              ))}
              {jobs.data?.queues.length === 0 && (
                <tr><td colSpan={4} className="muted">No jobs have run yet.</td></tr>
              )}
            </tbody>
          </table>
        </QueryState>
      </section>

      <section className="admin-section">
        <div className="section-head">
          <h2>Recent jobs</h2>
          <select className="select select-inline" value={state} onChange={(e) => setState(e.target.value)} aria-label="Job state">
            <option value="failed">Failed</option>
            <option value="retry">Retrying</option>
            <option value="active">Running</option>
            <option value="created">Waiting</option>
            <option value="completed">Completed</option>
            <option value="">All</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">State</th>
                <th scope="col">Created</th>
                <th scope="col" className="num-col">Retries</th>
                <th scope="col">Output</th>
                {isAdmin && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {jobs.data?.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{JOB_LABEL[j.name] ?? j.name}</td>
                  <td><StatusPill kind={j.state === 'failed' ? 'bad' : j.state === 'completed' ? 'ok' : j.state === 'retry' ? 'warn' : 'idle'}>{j.state}</StatusPill></td>
                  <td className="num">{formatRelative(j.createdOn)}</td>
                  <td className="num-col num">{j.retryCount}</td>
                  <td className="output-cell">{j.output ? <code>{JSON.stringify(j.output).slice(0, 160)}</code> : '–'}</td>
                  {isAdmin && (
                    <td className="num-col">
                      {j.state === 'failed' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => retry.mutate(j)} disabled={retry.isPending}>
                          <RotateCw aria-hidden /> Retry
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {jobs.data?.jobs.length === 0 && (
                <tr><td colSpan={isAdmin ? 6 : 5} className="muted">No jobs in this state.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-section">
        <div className="section-head">
          <h2>Map data refresh</h2>
          {isAdmin && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setConfirmRefresh(true)} disabled={active}>
              <RefreshCw aria-hidden /> {active ? 'Refresh in progress' : 'Refresh map data'}
            </button>
          )}
        </div>
        <p className="field-hint">Downloads the latest Australia extract, then rebuilds the routing graph, map tiles and search index. Runs automatically each month.</p>
        <QueryState isLoading={runs.isLoading} error={runs.error}>
          {runs.data?.items.length === 0 ? (
            <p className="empty">No refresh has run yet. The map, routing and search stay unavailable until the first one finishes.</p>
          ) : (
            <ul className="run-list">
              {runs.data?.items.map((r) => (
                <li key={r.id}>
                  <details open={r.status === 'running'}>
                    <summary>
                      <StatusPill kind={r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'bad' : r.status === 'running' ? 'warn' : 'idle'}>{r.status}</StatusPill>
                      <span className="num">Started {formatDateTime(r.startedAt)}</span>
                      {r.finishedAt && <span className="muted num">finished {formatRelative(r.finishedAt)}</span>}
                      {r.osmDataDate && <span className="muted">data from {formatDateTime(r.osmDataDate)}</span>}
                    </summary>
                    <pre className="stack">{r.logTail || 'No output yet.'}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </section>

      <ConfirmDialog
        open={confirmRefresh}
        title="Refresh map data?"
        body={<><p>This uses a lot of memory and CPU for one to two hours. Routing keeps working on the old data until the new graph is ready, then restarts briefly.</p></>}
        confirmLabel="Start refresh"
        typeToConfirm="REFRESH"
        busy={refresh.isPending}
        error={refresh.error ? errorMessage(refresh.error) : null}
        onConfirm={(typed) => refresh.mutate(typed)}
        onCancel={() => setConfirmRefresh(false)}
      />
    </>
  );
}
