import { formatNumber } from '../../lib/format';
import { ChartCard } from '../charts';
import { useUsage } from '../hooks';
import { PageHeader, QueryState } from './common';

const dayLabel = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const KIND_LABEL: Record<string, string> = { fastest: 'Fastest', explore: 'Explore', roundtrip: 'Round trip', discover: 'Discover' };

export function UsagePage() {
  const usage = useUsage();
  const u = usage.data;
  return (
    <>
      <PageHeader title="Usage" description="How the group is using the app over the last 30 days." />
      <QueryState isLoading={usage.isLoading} error={usage.error}>
        {u && (
          <>
            <section className="admin-section">
              <dl className="kv-grid">
                <div><dt>Accounts</dt><dd className="num">{formatNumber(u.totalUsers)}</dd></div>
                <div><dt>Active today</dt><dd className="num">{formatNumber(u.dau)}</dd></div>
                <div><dt>Active this week</dt><dd className="num">{formatNumber(u.wau)}</dd></div>
                <div><dt>Background tracking on</dt><dd className="num">{u.trackingOptInPct}%</dd></div>
                <div><dt>Area explored, everyone</dt><dd className="num">{formatNumber(u.exploredKm2Total)} km²</dd></div>
                <div><dt>Newly explored this week</dt><dd className="num">{formatNumber(u.exploredKm2Week)} km²</dd></div>
              </dl>
            </section>
            <div className="admin-grid-2">
              <ChartCard title="Sign-ups per day" data={u.signupsByDay} xKey="day" kind="bar" series={[{ key: 'count', label: 'Sign-ups', slot: 1 }]} xFormat={dayLabel} format={(v) => formatNumber(v)} empty="No sign-ups in the last 30 days." />
              <ChartCard title="Trips per day" data={u.tripsByDay} xKey="day" kind="stacked-bar" series={[{ key: 'car', label: 'Drive', slot: 1 }, { key: 'foot', label: 'Walk', slot: 2 }]} xFormat={dayLabel} format={(v) => formatNumber(v)} empty="No trips recorded in the last 30 days." />
              <ChartCard title="Route requests by kind" data={u.routesByKind.map((r) => ({ kind: KIND_LABEL[r.kind] ?? r.kind, count: r.count }))} xKey="kind" kind="bar" layout="vertical" series={[{ key: 'count', label: 'Requests', slot: 1 }]} format={(v) => formatNumber(v)} height={180} empty="No routes requested yet." />
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}
