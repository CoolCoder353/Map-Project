import { useMemo } from 'react';
import { Link } from 'react-router';
import { formatBytes, formatDateTime, formatMs, formatNumber, formatRelative } from '../../lib/format';
import { ChartCard } from '../charts';
import { useErrors, useHealth, useMetrics, useSystem, useUsage } from '../hooks';
import { PageHeader, QueryState, StatusPill } from './common';

const SERVICE_LABEL: Record<string, string> = { api: 'API', database: 'Database', graphhopper: 'Routing engine', worker: 'Worker' };
const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

export function OverviewPage() {
  const health = useHealth();
  const system = useSystem(24);
  const errors = useErrors();
  const usage = useUsage();
  const from = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const route = useMetrics({ metric: 'route', groupBy: 'hour', from });

  const errors24h = (errors.data?.groups ?? []).filter((g) => Date.now() - new Date(g.lastSeen).getTime() < 86_400_000).reduce((n, g) => n + g.count, 0);
  const explore = (route.data?.points ?? []).filter((p) => p.label === 'explore');
  const exploreP95 = explore.length ? Math.max(...explore.map((p) => p.p95Ms ?? 0)) : null;
  const sys = health.data?.system;
  const samples = (system.data?.samples ?? []).map((s) => ({ ...s, memGb: s.memUsedBytes / 1024 ** 3, diskGb: s.diskUsedBytes / 1024 ** 3 }));
  const osmAgeDays = health.data?.osmDataDate ? (Date.now() - new Date(health.data.osmDataDate).getTime()) / 86_400_000 : null;

  return (
    <>
      <PageHeader title="Overview" description="Service health and the last 24 hours at a glance. Refreshes every 30 seconds." />
      <QueryState isLoading={health.isLoading} error={health.error}>
        <section className="admin-section" aria-labelledby="svc">
          <h2 id="svc">Services</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Status</th>
                <th scope="col" className="num-col">Response</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {health.data?.services.map((s) => (
                <tr key={s.name}>
                  <td>{SERVICE_LABEL[s.name] ?? s.name}</td>
                  <td><StatusPill kind={s.up ? 'ok' : 'bad'}>{s.up ? 'Up' : 'Down'}</StatusPill></td>
                  <td className="num-col num">{formatMs(s.latencyMs)}</td>
                  <td className="muted">{s.detail ?? '–'}</td>
                </tr>
              ))}
              <tr>
                <td>Map data</td>
                <td>
                  <StatusPill kind={osmAgeDays === null ? 'idle' : osmAgeDays > 45 ? 'warn' : 'ok'}>
                    {osmAgeDays === null ? 'Not built' : osmAgeDays > 45 ? 'Stale' : 'Current'}
                  </StatusPill>
                </td>
                <td className="num-col num">–</td>
                <td className="muted">
                  {health.data?.osmDataDate ? `OpenStreetMap data from ${formatDateTime(health.data.osmDataDate)}` : <Link to="/admin/jobs">Run a data refresh</Link>}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </QueryState>

      <section className="admin-section" aria-labelledby="now">
        <h2 id="now">Right now</h2>
        <dl className="kv-grid">
          <div><dt>Errors, last 24 h</dt><dd className="num"><Link to="/admin/errors">{formatNumber(errors24h)}</Link></dd></div>
          <div><dt>Active users today</dt><dd className="num">{usage.data ? formatNumber(usage.data.dau) : '–'}</dd></div>
          <div><dt>Explore route p95, 24 h</dt><dd className="num">{formatMs(exploreP95)}</dd></div>
          <div><dt>CPU</dt><dd className="num">{sys ? `${Math.round(sys.cpuPct)}%` : '–'}</dd></div>
          <div><dt>Memory</dt><dd className="num">{sys ? `${formatBytes(sys.memUsedBytes)} of ${formatBytes(sys.memTotalBytes)}` : '–'}</dd></div>
          <div><dt>Disk</dt><dd className="num">{sys ? `${formatBytes(sys.diskUsedBytes)} of ${formatBytes(sys.diskTotalBytes)}` : '–'}</dd></div>
        </dl>
        {sys && <p className="field-hint">System sampled {formatRelative(sys.ts, { midSentence: true })}.</p>}
      </section>

      <section className="admin-grid-3" aria-label="System, last 24 hours">
        <ChartCard title="CPU, %" data={samples} xKey="ts" kind="line" series={[{ key: 'cpuPct', label: 'CPU', slot: 1 }]} height={140} xFormat={hourLabel} format={(v) => `${Math.round(v)}%`} empty="No samples yet. Is the worker running?" />
        <ChartCard title="Memory used, GB" yDomain={sys ? [0, Math.ceil(sys.memTotalBytes / 1024 ** 3)] : undefined} data={samples} xKey="ts" kind="line" series={[{ key: 'memGb', label: 'Memory', slot: 1 }]} height={140} xFormat={hourLabel} format={(v) => v.toFixed(1)} empty="No samples yet." />
        <ChartCard title="Job queue depth" data={samples} xKey="ts" kind="line" series={[{ key: 'queueDepth', label: 'Queued jobs', slot: 1 }]} integer height={140} xFormat={hourLabel} format={(v) => String(Math.round(v))} empty="No samples yet." />
      </section>
    </>
  );
}
