import type { MetricPoint } from '@wayfinder/shared';
import { useMemo, useState } from 'react';
import { formatMs, formatNumber } from '../../lib/format';
import { ChartCard } from '../charts';
import { useMetrics } from '../hooks';
import { PageHeader, QueryState } from './common';
import { mergeBuckets } from './metrics-util';

const RANGES = {
  '3h': { label: 'Last 3 hours', groupBy: 'minute' as const, ms: 3 * 3600_000 },
  '2d': { label: 'Last 2 days', groupBy: 'hour' as const, ms: 2 * 86_400_000 },
  '30d': { label: 'Last 30 days', groupBy: 'day' as const, ms: 30 * 86_400_000 },
};
type RangeKey = keyof typeof RANGES;

export function PerformancePage() {
  const [range, setRange] = useState<RangeKey>('2d');
  const r = RANGES[range];
  const from = useMemo(() => new Date(Date.now() - r.ms).toISOString(), [r.ms]);
  const http = useMetrics({ metric: 'http.request', groupBy: r.groupBy, from });
  const routes = useMetrics({ metric: 'route', groupBy: r.groupBy, from });
  const gh = useMetrics({ metric: 'graphhopper', groupBy: r.groupBy, from });
  const jobs = useMetrics({ metric: 'job', groupBy: r.groupBy, from });

  const xFormat = (iso: string) =>
    r.groupBy === 'day'
      ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
      : new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

  const series = useMemo(() => mergeBuckets(http.data?.points ?? []), [http.data]);
  const byEndpoint = useMemo(() => summarise(http.data?.points ?? []), [http.data]);
  const byRoute = useMemo(() => summarise(routes.data?.points ?? []), [routes.data]);
  const byEngine = useMemo(() => summarise(gh.data?.points ?? []), [gh.data]);
  const byJob = useMemo(() => summarise(jobs.data?.points ?? []), [jobs.data]);

  return (
    <>
      <PageHeader
        title="Performance"
        description="Request volume, errors and response times from the built-in metrics."
        actions={
          <select className="select" value={range} onChange={(e) => setRange(e.target.value as RangeKey)} aria-label="Time range">
            {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        }
      />
      <QueryState isLoading={http.isLoading} error={http.error}>
        <div className="admin-grid-2">
          <ChartCard title="Requests" description="All API requests per interval" data={series} xKey="bucket" kind="line" series={[{ key: 'count', label: 'Requests', slot: 1 }]} xFormat={xFormat} format={(v) => formatNumber(Math.round(v))} />
          <ChartCard title="Server errors, %" description="Share of requests answered with 5xx" data={series} xKey="bucket" kind="line" series={[{ key: 'errorPct', label: 'Errors', slot: 1 }]} xFormat={xFormat} format={(v) => `${v.toFixed(1)}%`} />
          <ChartCard title="Response time" description="Across all endpoints (upper bound of the busiest endpoint)" data={series} xKey="bucket" kind="line" series={[{ key: 'p50', label: 'p50', slot: 1 }, { key: 'p95', label: 'p95', slot: 2 }]} xFormat={xFormat} format={formatMs} />
          <ChartCard title="Route requests by kind" description="Count over the whole range" data={byRoute.map((r) => ({ name: r.label, count: r.count }))} xKey="name" kind="bar" layout="vertical" series={[{ key: 'count', label: 'Requests', slot: 1 }]} format={(v) => formatNumber(v)} height={180} />
        </div>
      </QueryState>

      <MetricTable title="Routing" caption="End-to-end time for each kind of route request, including all routing-engine calls." rows={byRoute} />
      <MetricTable title="Routing engine calls" caption="Individual GraphHopper requests. Explore and loop requests make several." rows={byEngine} />
      <MetricTable title="Endpoints" caption="Slowest first." rows={[...byEndpoint].sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0))} />
      <MetricTable title="Background jobs" caption="Worker job runs." rows={byJob} />
    </>
  );
}

interface Row {
  label: string;
  count: number;
  errors: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

function summarise(points: MetricPoint[]): Row[] {
  const map = new Map<string, Row>();
  for (const p of points) {
    const r = map.get(p.label) ?? { label: p.label, count: 0, errors: 0, p50: null, p95: null, max: null };
    r.count += p.count;
    r.errors += p.errorCount;
    // Bucket percentiles can't be averaged exactly; weight p50 and take the worst p95.
    r.p50 = p.p50Ms === null ? r.p50 : r.p50 === null ? p.p50Ms : (r.p50 * (r.count - p.count) + p.p50Ms * p.count) / r.count;
    r.p95 = p.p95Ms === null ? r.p95 : Math.max(r.p95 ?? 0, p.p95Ms);
    r.max = p.maxMs === null ? r.max : Math.max(r.max ?? 0, p.maxMs);
    map.set(p.label, r);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function MetricTable({ title, caption, rows }: { title: string; caption: string; rows: Row[] }) {
  return (
    <section className="admin-section">
      <h2>{title}</h2>
      <p className="field-hint">{caption}</p>
      {rows.length === 0 ? (
        <p className="empty">Nothing recorded in this period.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="num-col">Count</th>
                <th scope="col" className="num-col">Errors</th>
                <th scope="col" className="num-col">p50</th>
                <th scope="col" className="num-col">p95</th>
                <th scope="col" className="num-col">Max</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="mono-ish">{r.label || '–'}</td>
                  <td className="num-col num">{formatNumber(r.count)}</td>
                  <td className="num-col num">{r.errors ? <span className="badge badge-danger">{formatNumber(r.errors)}</span> : '0'}</td>
                  <td className="num-col num">{formatMs(r.p50)}</td>
                  <td className="num-col num">{formatMs(r.p95)}</td>
                  <td className="num-col num">{formatMs(r.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
