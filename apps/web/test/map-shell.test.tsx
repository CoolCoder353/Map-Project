import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { MapShell } from '../src/map/MapShell';
import { usePlanner } from '../src/planner/PlannerState';
import { place, user } from './fixtures';
import { renderApp, where } from './harness';

/** Stand-in for a planner tab, showing what the shell put into planner state. */
function Tab({ name }: { name: string }) {
  const p = usePlanner();
  return (
    <div>
      <h2>{name} tab</h2>
      <button type="button" onClick={() => p.setPickTarget('from')}>pick start</button>
      <p data-testid="from">{p.from?.name ?? ''}</p>
      <p data-testid="to">{p.to?.name ?? ''}</p>
    </div>
  );
}

const TABS = ['directions', 'loop', 'discover', 'coverage', 'trips', 'settings'];

/** MapShell renders the tab through <Outlet>, so mount it as a layout route. */
function ShellWithTabs() {
  return (
    <Routes>
      <Route element={<MapShell />}>
        {TABS.map((t) => (
          <Route key={t} path={`/${t}`} element={<Tab name={t} />} />
        ))}
      </Route>
    </Routes>
  );
}

const renderShell = (path: string, opts: Parameters<typeof renderApp>[1] = {}) => renderApp(<ShellWithTabs />, { path, pattern: '/*', ...opts });

afterEach(() => {
  delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('Map shell', () => {
  it('switches between planner tabs', async () => {
    await renderShell('/directions');
    const nav = screen.getByRole('navigation', { name: 'Planner' });
    for (const [label, path] of [['Round trip', '/loop'], ['Discover', '/discover'], ['Coverage', '/coverage'], ['Trips', '/trips'], ['Directions', '/directions']] as const) {
      await userEvent.click(within(nav).getByRole('link', { name: label }));
      expect(where()).toBe(path);
    }
  });

  it('has a place search on every tab but Directions, and hands a place to Directions', async () => {
    const { map } = await renderShell('/discover', { api: { 'GET /api/search': () => ({ results: [place({ hours: { openNow: false, label: 'Opens 8 am' } })] }) } });
    expect(screen.queryByRole('combobox', { name: 'Search' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Search' }), 'gumdale');
    await userEvent.click(await screen.findByRole('option', { name: /Gumdale State School/ }));
    expect(map.flyTo).toHaveBeenCalledWith([153.15, -27.49], 15);
    expect(map.setSearchPin).toHaveBeenLastCalledWith({ lngLat: [153.15, -27.49], label: 'Gumdale State School' });
    expect(screen.getByText('Opens 8 am')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Directions' }));
    expect(where()).toBe('/directions');
    expect(screen.getByTestId('to')).toHaveTextContent('Gumdale State School');
    expect(screen.queryByRole('combobox', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('clears a searched place', async () => {
    const { map } = await renderShell('/trips', { api: { 'GET /api/search': () => ({ results: [place()] }) } });
    await userEvent.type(screen.getByRole('combobox', { name: 'Search' }), 'gumdale');
    await userEvent.click(await screen.findByRole('option', { name: /Gumdale State School/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear place' }));
    expect(map.setSearchPin).toHaveBeenLastCalledWith(null);
  });

  it('fills a field from a map click, named by reverse geocoding', async () => {
    const { map, api } = await renderShell('/directions', { api: { 'GET /api/reverse': () => ({ place: place({ name: '12 Smith Street', description: 'Address' }) }) } });
    await userEvent.click(screen.getByRole('button', { name: 'pick start' }));
    expect(document.body).toHaveClass('is-picking');
    act(() => map.click([153.01, -27.41]));
    expect(screen.getByTestId('from')).toHaveTextContent('Dropped pin');
    await waitFor(() => expect(screen.getByTestId('from')).toHaveTextContent('12 Smith Street'));
    expect(Object.fromEntries(api.calls('GET /api/reverse')[0]!.query)).toEqual({ lon: '153.01', lat: '-27.41' });
    expect(document.body).not.toHaveClass('is-picking');
  });

  it('keeps the dropped pin when nothing is found there', async () => {
    const { map } = await renderShell('/directions', { api: { 'GET /api/reverse': () => ({ place: null }) } });
    await userEvent.click(screen.getByRole('button', { name: 'pick start' }));
    act(() => map.click([153.01, -27.41]));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('from')).toHaveTextContent('Dropped pin');
  });

  it('settings hides the tabs and goes back to where you were, query and all', async () => {
    await renderShell('/directions?to=153,-27,Work', { user: user({ role: 'admin' }) });
    await userEvent.click(screen.getByRole('button', { name: /Account:/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(where()).toBe('/settings');
    expect(screen.queryByRole('navigation', { name: 'Planner' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(where()).toBe('/directions?to=153,-27,Work');
  });

  it('collapses and expands the panel', async () => {
    await renderShell('/directions');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(screen.getByRole('complementary')).toHaveClass('is-collapsed');
    await userEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
    expect(screen.getByRole('complementary')).not.toHaveClass('is-collapsed');
  });

  it('warns when the server has no map tiles', async () => {
    await renderShell('/directions', { map: { tilesAvailable: false } });
    expect(screen.getByText(/Map tiles haven’t been built on the server yet/)).toBeInTheDocument();
  });

  it('names the planner after the app', async () => {
    await renderShell('/directions', { config: { appName: 'Roamer' } });
    expect(await screen.findByRole('complementary', { name: 'Roamer planner' })).toBeInTheDocument();
  });
});

describe('Map controls', () => {
  it('toggles travelled roads, zooms, and finds you', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { longitude: 153.3, latitude: -27.3 } } as GeolocationPosition) },
      configurable: true,
    });
    const { map } = await renderShell('/directions');
    await userEvent.click(screen.getByRole('button', { name: 'Show explored areas' }));
    expect(map.setCoverageEnabled).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(map.zoomBy).toHaveBeenNthCalledWith(1, 1);
    expect(map.zoomBy).toHaveBeenNthCalledWith(2, -1);
    await userEvent.click(screen.getByRole('button', { name: 'Show my location' }));
    await waitFor(() => expect(map.flyTo).toHaveBeenCalledWith([153.3, -27.3], 15));
  });

  it('says why it can’t find you, and hides the roads toggle on Coverage', async () => {
    await renderShell('/coverage', { map: { coverageEnabled: true } });
    expect(screen.queryByRole('button', { name: /explored areas/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show my location' }));
    expect(await screen.findByText('Location is not available in this browser')).toBeInTheDocument();
  });
});
