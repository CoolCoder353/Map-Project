import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ErrorsPage } from '../src/admin/pages/ErrorsPage';
import { JobsPage } from '../src/admin/pages/JobsPage';
import { OverviewPage } from '../src/admin/pages/OverviewPage';
import { PerformancePage } from '../src/admin/pages/PerformancePage';
import { UsagePage } from '../src/admin/pages/UsagePage';
import { type Routes, apiError } from './fakeApi';
import { errorGroup, health, jobs, metric, pipelineRun, usage, user } from './fixtures';
import { renderApp } from './harness';

const admin = user({ role: 'admin', email: 'admin@example.test' });
const dev = user({ role: 'dev', email: 'dev@example.test' });

const overviewApi = (over: Routes = {}): Routes => ({
  'GET /api/admin/health': () => health(),
  'GET /api/admin/system': () => ({ samples: [{ ts: new Date().toISOString(), cpuPct: 20, memUsedBytes: 1e9, diskUsedBytes: 5e9, queueDepth: 2 }] }),
  'GET /api/admin/errors': () => ({ groups: [errorGroup(), errorGroup({ count: 99, lastSeen: '2026-01-01T00:00:00.000Z', latest: { ...errorGroup().latest, id: 'e-old' } })] }),
  'GET /api/admin/stats/usage': () => usage(),
  'GET /api/admin/metrics': () => ({ points: [metric({ p95Ms: 1800 }), metric({ p95Ms: 2600 }), metric({ label: 'fastest', p95Ms: 9000 })] }),
  ...over,
});

describe('Overview', () => {
  it('shows each service, the map data age and the last day at a glance', async () => {
    await renderApp(<OverviewPage />, { path: '/admin', user: admin, api: overviewApi() });
    const services = await screen.findByRole('region', { name: 'Services' });
    const rows = within(services).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('API Up2 ms');
    expect(rows[3]).toHaveTextContent('Routing engine Down–connect ECONNREFUSED');
    expect(rows[4]).toHaveTextContent('Map data Current');
    const now = screen.getByRole('region', { name: 'Right now' });
    // Only errors seen in the last 24 hours count.
    expect(within(now).getByText('Errors, last 24 h').nextSibling).toHaveTextContent('4');
    expect(within(now).getByText('Active users today').nextSibling).toHaveTextContent('3');
    // The worst explore p95; other route kinds don't count.
    expect(within(now).getByText('Explore route p95, 24 h').nextSibling).toHaveTextContent('2.6 s');
    expect(within(now).getByText('CPU').nextSibling).toHaveTextContent('37%');
    expect(within(now).getByText('Memory').nextSibling).toHaveTextContent('1.5 GB of 2.0 GB');
  });

  it('flags stale or missing map data', async () => {
    await renderApp(<OverviewPage />, { path: '/admin', user: admin, api: overviewApi({ 'GET /api/admin/health': () => health({ osmDataDate: '2026-01-01T00:00:00.000Z', system: null }) }) });
    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('CPU').nextSibling).toHaveTextContent('–');
  });

  it('links to a refresh when there is no map data', async () => {
    await renderApp(<OverviewPage />, { path: '/admin', user: admin, api: overviewApi({ 'GET /api/admin/health': () => health({ osmDataDate: null }) }) });
    expect(await screen.findByText('Not built')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Run a data refresh' })).toHaveAttribute('href', '/admin/jobs');
  });

  it('shows a health failure', async () => {
    await renderApp(<OverviewPage />, { path: '/admin', user: admin, api: overviewApi({ 'GET /api/admin/health': () => apiError(500, 'internal', 'Health check failed') }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Health check failed');
  });
});

describe('Performance', () => {
  const points = [
    metric({ metric: 'http.request', label: 'GET /api/search', count: 100, errorCount: 2, p50Ms: 20, p95Ms: 80, maxMs: 300 }),
    metric({ metric: 'http.request', label: 'POST /api/routes/explore', count: 10, p50Ms: 600, p95Ms: 2400, maxMs: 4000 }),
  ];

  it('summarises endpoints slowest first and changes range', async () => {
    const { api } = await renderApp(<PerformancePage />, {
      path: '/admin/performance',
      user: admin,
      api: { 'GET /api/admin/metrics': (req) => ({ points: req.query.get('metric') === 'http.request' ? points : [] }) },
    });
    const endpoints = await screen.findByRole('heading', { name: 'Endpoints' });
    const rows = within(endpoints.closest('section')!).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('POST /api/routes/explore10');
    expect(rows[2]).toHaveTextContent('GET /api/search1002');
    expect(within(screen.getByRole('heading', { name: 'Background jobs' }).closest('section')!).getByText('Nothing recorded in this period.')).toBeInTheDocument();
    expect(new Set(api.calls('GET /api/admin/metrics').map((r) => r.query.get('groupBy')))).toEqual(new Set(['hour']));
    await userEvent.selectOptions(screen.getByLabelText('Time range'), 'Last 30 days');
    await waitFor(() => expect(api.calls('GET /api/admin/metrics').at(-1)!.query.get('groupBy')).toBe('day'));
  });

  it('shows charts as tables', async () => {
    await renderApp(<PerformancePage />, { path: '/admin/performance', user: admin, api: { 'GET /api/admin/metrics': () => ({ points }) } });
    const requests = await screen.findByRole('region', { name: 'Requests' });
    await userEvent.click(within(requests).getByRole('button', { name: 'Show as table' }));
    const rows = within(within(requests).getByRole('table')).getAllByRole('row');
    expect(rows.slice(1).map((r) => r.lastChild!.textContent)).toEqual(['100', '10']);
    await userEvent.click(within(requests).getByRole('button', { name: 'Show chart' }));
    expect(within(requests).queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Errors', () => {
  it('groups errors with their latest stack and filters by service', async () => {
    const { api } = await renderApp(<ErrorsPage />, { path: '/admin/errors', user: admin, api: { 'GET /api/admin/errors': () => ({ groups: [errorGroup()] }) } });
    expect(await screen.findByLabelText('4 occurrences')).toBeInTheDocument();
    expect(screen.getByText(/at explore/)).toBeInTheDocument();
    expect(screen.getByText('req-1')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Service'), 'Worker');
    await waitFor(() => expect(api.calls('GET /api/admin/errors').at(-1)!.query.get('service')).toBe('worker'));
  });

  it('says when there are none', async () => {
    await renderApp(<ErrorsPage />, { path: '/admin/errors', user: admin, api: { 'GET /api/admin/errors': () => ({ groups: [] }) } });
    expect(await screen.findByText('No errors recorded. Nice.')).toBeInTheDocument();
  });
});

describe('Jobs & data', () => {
  const jobsApi = (over: Routes = {}): Routes => ({
    'GET /api/admin/jobs': () => jobs(),
    'GET /api/admin/pipeline/runs': () => ({ items: [pipelineRun()] }),
    ...over,
  });

  it('lists queues by name and failed jobs with their output', async () => {
    await renderApp(<JobsPage />, { path: '/admin/jobs', user: admin, api: jobsApi() });
    expect(await screen.findByRole('row', { name: /Process uploaded tracks 1 0 2/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /mystery-queue/ })).toBeInTheDocument();
    expect(screen.getByText('{"message":"boom"}')).toBeInTheDocument();
    expect(screen.getByText('== graph done')).toBeInTheDocument();
  });

  it('lets an admin retry a failed job', async () => {
    const { api } = await renderApp(<JobsPage />, { path: '/admin/jobs', user: admin, api: jobsApi({ 'POST /api/admin/jobs/process-tracks/j-1/retry': () => ({ ok: true }) }) });
    await userEvent.click(await screen.findByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Job queued for retry.')).toBeInTheDocument();
    expect(api.calls('POST /api/admin/jobs/process-tracks/j-1/retry')).toHaveLength(1);
  });

  it('filters by state', async () => {
    const { api } = await renderApp(<JobsPage />, { path: '/admin/jobs', user: admin, api: jobsApi() });
    await screen.findByText('{"message":"boom"}');
    expect(api.calls('GET /api/admin/jobs')[0]!.query.get('state')).toBe('failed');
    await userEvent.selectOptions(screen.getByLabelText('Job state'), 'All');
    await waitFor(() => expect(api.calls('GET /api/admin/jobs').at(-1)!.query.has('state')).toBe(false));
  });

  it('starts a map data refresh only after typing REFRESH', async () => {
    const { api } = await renderApp(<JobsPage />, { path: '/admin/jobs', user: admin, api: jobsApi({ 'POST /api/admin/pipeline/refresh': () => ({ ok: true }) }) });
    await userEvent.click(await screen.findByRole('button', { name: /Refresh map data/ }));
    const start = screen.getByRole('button', { name: 'Start refresh' });
    expect(start).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to confirm/), 'refresh');
    await userEvent.click(start);
    expect(await screen.findByText('Data refresh queued. It takes one to two hours.')).toBeInTheDocument();
    expect(api.calls('POST /api/admin/pipeline/refresh')[0]!.body).toEqual({ confirm: 'refresh' });
  });

  it('won’t start a second refresh while one runs', async () => {
    await renderApp(<JobsPage />, { path: '/admin/jobs', user: admin, api: jobsApi({ 'GET /api/admin/pipeline/runs': () => ({ items: [pipelineRun({ status: 'running', finishedAt: null })] }) }) });
    expect(await screen.findByRole('button', { name: /Refresh in progress/ })).toBeDisabled();
  });

  it('is read-only for devs', async () => {
    await renderApp(<JobsPage />, { path: '/admin/jobs', user: dev, api: jobsApi() });
    await screen.findByText('{"message":"boom"}');
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh map data/ })).not.toBeInTheDocument();
  });

  it('explains an empty pipeline history', async () => {
    await renderApp(<JobsPage />, { path: '/admin/jobs', user: admin, api: jobsApi({ 'GET /api/admin/pipeline/runs': () => ({ items: [] }), 'GET /api/admin/jobs': () => jobs({ queues: [], jobs: [] }) }) });
    expect(await screen.findByText(/No refresh has run yet/)).toBeInTheDocument();
    expect(screen.getByText('No jobs have run yet.')).toBeInTheDocument();
    expect(screen.getByText('No jobs in this state.')).toBeInTheDocument();
  });
});

describe('Usage', () => {
  it('shows the headline numbers', async () => {
    await renderApp(<UsagePage />, { path: '/admin/usage', user: admin, api: { 'GET /api/admin/stats/usage': () => usage() } });
    expect(await screen.findByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Background tracking on').nextSibling).toHaveTextContent('57%');
    expect(screen.getByText('Area explored, everyone').nextSibling).toHaveTextContent('1,234 km²');
  });
});
