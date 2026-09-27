import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CoveragePanel } from '../src/planner/CoveragePanel';
import { DiscoverPanel } from '../src/planner/DiscoverPanel';
import { usePlanner } from '../src/planner/PlannerState';
import { RoundTripPanel } from '../src/planner/RoundTripPanel';
import { apiError } from './fakeApi';
import { coverageStats, discoverItem, place, route, user } from './fixtures';
import { renderApp, where } from './harness';

const loop = (id: string, durationS: number) => route({ id, kind: 'roundtrip', durationS, novelty: { totalKm: 20, newKm: 8, noveltyPct: 40 } });

function StartAt({ children }: { children: React.ReactNode }) {
  const p = usePlanner();
  return (
    <>
      <button type="button" onClick={() => p.setLoopStart({ name: 'Home', description: '', location: [153, -27.5] })}>set start</button>
      <p data-testid="planner">{JSON.stringify({ from: p.from?.name ?? null, to: p.to?.name ?? null })}</p>
      {children}
    </>
  );
}

describe('Round trip', () => {
  it('needs a start, then makes loops of about the chosen length and sends one to the phone', async () => {
    const { api, map } = await renderApp(
      <StartAt>
        <RoundTripPanel />
      </StartAt>,
      {
        path: '/loop',
        user: user({ settings: { defaultMode: 'foot' } }),
        api: {
          'POST /api/routes/roundtrip': () => ({ routes: [loop('l1', 3500), loop('l2', 3700)] }),
          'POST /api/planned-routes': () => ({ id: 'pr' }),
        },
      },
    );
    expect(screen.getByRole('button', { name: 'Make loops' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'set start' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make loops' }));
    const list = await screen.findByRole('list', { name: 'Loops' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(api.calls('POST /api/routes/roundtrip')[0]!.body).toEqual({ start: [153, -27.5], mode: 'foot', targetMin: 60 });
    expect(map.fitTo).toHaveBeenCalled();
    expect(map.setMarkers).toHaveBeenLastCalledWith([{ id: 'start', lngLat: [153, -27.5], kind: 'start', label: 'Home' }]);
    act(() => map.clickRoute('l2'));
    expect(screen.getByRole('button', { name: /Loop 2/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Send to phone/ }));
    await screen.findByText('Saved. Open Planned routes on your phone to start.');
    expect(api.calls('POST /api/planned-routes')[0]!.body).toMatchObject({ name: '1 h 2 min loop from Home', route: { id: 'l2' } });
    expect(screen.getByRole('button', { name: 'Make new loops' })).toBeEnabled();
  });

  it('says when no loop fits, and shows routing errors', async () => {
    let fail = false;
    await renderApp(
      <StartAt>
        <RoundTripPanel />
      </StartAt>,
      { path: '/loop', api: { 'POST /api/routes/roundtrip': () => (fail ? apiError(503, 'routing_unavailable', 'The routing engine is restarting') : { routes: [] }) } },
    );
    await userEvent.click(screen.getByRole('button', { name: 'set start' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make loops' }));
    expect(await screen.findByText(/Couldn’t make a loop that length from here/)).toBeInTheDocument();
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Make new loops' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The routing engine is restarting');
  });
});

describe('Discover', () => {
  it('finds places from the middle of the map, filtered by category and time', async () => {
    const { api, map } = await renderApp(
      <StartAt>
        <DiscoverPanel />
      </StartAt>,
      {
        path: '/discover',
        routes: [{ path: '/directions', element: <StartAt>{null}</StartAt> }],
        api: { 'GET /api/discover': () => ({ items: [discoverItem(), discoverItem({ id: 'd-2', name: 'Cafe Nine', category: 'cafe', areaUnexploredPct: 10, distanceM: 900 })] }) },
      },
    );
    await userEvent.click(screen.getByRole('button', { name: /Lookouts/ }));
    await userEvent.click(screen.getByRole('button', { name: /Cafés/ }));
    await userEvent.click(screen.getByRole('button', { name: /Cafés/ }));
    expect(screen.getByRole('button', { name: /Lookouts/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Find places' }));
    const lookout = await screen.findByRole('button', { name: /^Mount Coot-tha Lookout/ });
    expect(lookout).toHaveTextContent('Lookout · 7.4 km away');
    expect(lookout).toHaveTextContent('80% unexplored area');
    expect(screen.getByRole('button', { name: /^Cafe Nine/ })).not.toHaveTextContent('unexplored');
    expect(Object.fromEntries(api.calls('GET /api/discover')[0]!.query)).toEqual({ lon: '153.02', lat: '-27.47', mode: 'car', maxMinutes: '30', categories: 'viewpoint', limit: '25' });
    expect(map.fitTo).toHaveBeenCalled();
    // Labels on the map while the list is short.
    expect(map.setMarkers).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'd-1', kind: 'poi', label: 'Mount Coot-tha Lookout' })]));
    await userEvent.click(lookout);
    expect(map.flyTo).toHaveBeenCalledWith([152.95, -27.48], 15);
    await userEvent.click(screen.getByRole('button', { name: 'Directions to Mount Coot-tha Lookout' }));
    expect(where()).toBe('/directions');
    expect(screen.getByTestId('planner')).toHaveTextContent('"to":"Mount Coot-tha Lookout"');
  });

  it('says when nothing new is in reach, and shows errors', async () => {
    let fail = false;
    await renderApp(<DiscoverPanel />, {
      path: '/discover',
      api: { 'GET /api/discover': () => (fail ? apiError(503, 'routing_unavailable', 'Routing is down') : { items: [] }) },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByText('Nothing new within reach. Try a longer time or another category.')).toBeInTheDocument();
    fail = true;
    await userEvent.click(screen.getByRole('button', { name: 'Find places' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Routing is down');
  });

  it('searches from a chosen place', async () => {
    const { api } = await renderApp(<DiscoverPanel />, {
      path: '/discover',
      api: { 'GET /api/search': () => ({ results: [place()] }), 'GET /api/discover': () => ({ items: [] }) },
    });
    await userEvent.type(screen.getByRole('combobox', { name: 'Search from' }), 'gumdale');
    await userEvent.click(await screen.findByRole('option', { name: /Gumdale State School/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Find places' }));
    await waitFor(() => expect(api.calls('GET /api/discover')).toHaveLength(1));
    expect(api.calls('GET /api/discover')[0]!.query.get('lon')).toBe('153.15');
  });
});

describe('Coverage', () => {
  it('turns on the travelled-roads layer while open and shows road stats', async () => {
    const { map } = await renderApp(<CoveragePanel />, { path: '/coverage', api: { 'GET /api/coverage/stats': () => coverageStats() } });
    expect(map.setCoverageEnabled).toHaveBeenCalledWith(true);
    expect(await screen.findByText('412.5')).toBeInTheDocument();
    expect(screen.getByText('+17 new roads this week')).toBeInTheDocument();
    const stats = screen.getByText('Roads travelled').closest('dl')!;
    expect(stats).toHaveTextContent('Roads travelled1,234');
    expect(stats).toHaveTextContent('New this month60');
    expect(stats).toHaveTextContent('Driven400 km');
    expect(stats).toHaveTextContent('Walked12.5 km');
    expect(stats).toHaveTextContent('Trips42');
    expect(screen.getByText(/Exploring since/)).toBeInTheDocument();
    expect(screen.getByLabelText('Map legend')).toHaveTextContent('Roads you’ve travelled');
  });

  it('never talks about hexagons, cells or fog', async () => {
    await renderApp(<CoveragePanel />, { path: '/coverage', api: { 'GET /api/coverage/stats': () => coverageStats() } });
    await screen.findByText('412.5');
    expect(document.body.textContent).not.toMatch(/hexagon|\bcells?\b|fog/i);
  });

  it('explains an empty map and tracking being off', async () => {
    await renderApp(<CoveragePanel />, {
      path: '/coverage',
      user: user({ settings: { trackingEnabled: false } }),
      api: { 'GET /api/coverage/stats': () => coverageStats({ roadsTravelled: 0, roadKm: 0, newRoadsWeek: 0, firstVisitAt: null }) },
    });
    expect(await screen.findByText(/Nothing recorded yet/)).toBeInTheDocument();
    expect(screen.getByText('Background tracking is off. You can turn it on in the Android app.')).toBeInTheDocument();
    expect(screen.queryByText(/Exploring since/)).not.toBeInTheDocument();
  });

  it('shows an error when stats fail', async () => {
    await renderApp(<CoveragePanel />, { path: '/coverage', api: { 'GET /api/coverage/stats': () => apiError(500, 'internal', 'Database unavailable') } });
    expect(await screen.findByText(/Couldn’t load your stats. Database unavailable/)).toBeInTheDocument();
  });
});
