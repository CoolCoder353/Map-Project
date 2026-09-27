import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionsPanel } from '../src/planner/DirectionsPanel';
import { apiError } from './fakeApi';
import { exploreResponse, place, route, user } from './fixtures';
import { renderApp, where } from './harness';

const FROM = 'from=153.00000,-27.40000,Home';
const TO = 'to=153.10000,-27.50000,Work';

function allowLocation(state: PermissionState, pos: [number, number] = [153.2, -27.6]) {
  Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state }) }, configurable: true });
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { longitude: pos[0], latitude: pos[1] } } as GeolocationPosition) },
    configurable: true,
  });
}
afterEach(() => {
  delete (navigator as { permissions?: unknown }).permissions;
  delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('Directions', () => {
  it('asks for a destination before anything is chosen', async () => {
    await renderApp(<DirectionsPanel />, { path: '/directions' });
    expect(screen.getByText(/Choose where you’re going/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveFocus();
  });

  it('fetches fastest and explore routes for a trip in the URL, fits the map and draws both ends', async () => {
    const { api, map } = await renderApp(<DirectionsPanel />, {
      path: `/directions?${FROM}&${TO}&mode=foot`,
      user: user({ settings: { exploreBudgetMin: 20 } }),
      api: { 'POST /api/routes/explore': () => exploreResponse() },
    });
    expect(await screen.findByRole('list', { name: 'Fastest route' })).toHaveTextContent('Fastest');
    const explore = screen.getByRole('list', { name: 'Ways you haven’t been' });
    expect(explore).toHaveTextContent('Explore 1');
    expect(explore).toHaveTextContent('6.2 km you’ve never been');
    expect(explore).toHaveTextContent('+7 min');
    expect(api.calls('POST /api/routes/explore')[0]!.body).toEqual({ from: [153, -27.4], to: [153.1, -27.5], mode: 'foot', budgetMin: 20 });
    // The map updates in effects after the list renders; wait for them to settle.
    await waitFor(() => {
      expect(map.fitTo).toHaveBeenCalled();
      expect(map.setMarkers).toHaveBeenLastCalledWith([
        { id: 'from', lngLat: [153, -27.4], kind: 'start', label: 'Home' },
        { id: 'to', lngLat: [153.1, -27.5], kind: 'end', label: 'Work' },
      ]);
      expect(map.setRoutes).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'r-fast' })]), 'r-fast', null);
    });
  });

  it('selects a route from the list or the map, and shows its steps', async () => {
    const { map } = await renderApp(<DirectionsPanel />, { path: `/directions?${FROM}&${TO}`, api: { 'POST /api/routes/explore': () => exploreResponse() } });
    const fastest = await screen.findByRole('button', { name: /Fastest/ });
    expect(fastest).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Explore 1/ }));
    expect(screen.getByRole('button', { name: /Explore 1/ })).toHaveAttribute('aria-pressed', 'true');
    act(() => map.clickRoute('r-fast'));
    expect(screen.getByRole('button', { name: /Fastest/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '2 steps' }));
    expect(screen.getByText('Head north on Queen Street')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide steps' }));
    expect(screen.queryByText('Head north on Queen Street')).not.toBeInTheDocument();
  });

  it('sends a route to the phone', async () => {
    const { api } = await renderApp(<DirectionsPanel />, {
      path: `/directions?${FROM}&${TO}`,
      api: { 'POST /api/routes/explore': () => exploreResponse(), 'POST /api/planned-routes': () => ({ id: 'pr-1' }) },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Send to phone/ }));
    expect(await screen.findByText('Saved. Open Planned routes on your phone to start.')).toBeInTheDocument();
    expect(api.calls('POST /api/planned-routes')[0]!.body).toMatchObject({ name: 'Fastest to Work', route: { id: 'r-fast' } });
  });

  it('says why a send failed', async () => {
    await renderApp(<DirectionsPanel />, {
      path: `/directions?${FROM}&${TO}`,
      api: { 'POST /api/routes/explore': () => exploreResponse(), 'POST /api/planned-routes': () => apiError(400, 'too_many', 'You have 50 planned routes already') },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Send to phone/ }));
    expect(await screen.findByText('You have 50 planned routes already')).toBeInTheDocument();
  });

  it('explains an empty explore list: budget too small, or the fastest is already new', async () => {
    await renderApp(<DirectionsPanel />, { path: `/directions?${FROM}&${TO}`, api: { 'POST /api/routes/explore': () => exploreResponse([]) } });
    expect(await screen.findByText('No explore routes fit within 15 extra minutes. Try a bigger budget.')).toBeInTheDocument();
  });

  it('says the fastest route already explores when it is almost all new', async () => {
    await renderApp(<DirectionsPanel />, {
      path: `/directions?${FROM}&${TO}`,
      api: { 'POST /api/routes/explore': () => ({ fastest: route({ novelty: { totalKm: 12, newKm: 11.5, noveltyPct: 95 } }), explore: [] }) },
    });
    expect(await screen.findByText(/already explores somewhere new/)).toBeInTheDocument();
  });

  it('shows the server’s error when routing fails', async () => {
    await renderApp(<DirectionsPanel />, {
      path: `/directions?${FROM}&${TO}`,
      api: { 'POST /api/routes/explore': () => apiError(422, 'no_route', 'No route between these points') },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('No route between these points');
  });

  it('re-plans when the mode or budget changes', async () => {
    const { api } = await renderApp(<DirectionsPanel />, { path: `/directions?${FROM}&${TO}`, api: { 'POST /api/routes/explore': () => exploreResponse() } });
    await screen.findByRole('list', { name: 'Fastest route' });
    await userEvent.click(screen.getByRole('radio', { name: 'Walk' }));
    await waitFor(() => expect(api.calls('POST /api/routes/explore').at(-1)!.body).toMatchObject({ mode: 'foot' }));
    expect(where()).toContain('mode=foot');
    const slider = screen.getByLabelText('Up to 15 min extra');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '30');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => expect(api.calls('POST /api/routes/explore').at(-1)!.body).toMatchObject({ budgetMin: 30 }));
    expect(screen.getByLabelText('Up to 30 min extra')).toBeInTheDocument();
  });

  it('swaps start and destination', async () => {
    const { api } = await renderApp(<DirectionsPanel />, { path: `/directions?${FROM}&${TO}`, api: { 'POST /api/routes/explore': () => exploreResponse() } });
    await screen.findByRole('list', { name: 'Fastest route' });
    await userEvent.click(screen.getByRole('button', { name: 'Swap start and destination' }));
    await waitFor(() => expect(api.calls('POST /api/routes/explore').at(-1)!.body).toMatchObject({ from: [153.1, -27.5], to: [153, -27.4] }));
    expect(screen.getByRole('combobox', { name: 'Starting point' })).toHaveValue('Work');
  });

  it('finds a destination by search and keeps the trip in the URL', async () => {
    const { api } = await renderApp(<DirectionsPanel />, {
      path: `/directions?${FROM}`,
      api: { 'GET /api/search': () => ({ results: [place()] }), 'POST /api/routes/explore': () => exploreResponse() },
    });
    await userEvent.type(screen.getByRole('combobox', { name: 'Destination' }), 'gumdale');
    await userEvent.click(await screen.findByRole('option', { name: /Gumdale State School/ }));
    await screen.findByRole('list', { name: 'Fastest route' });
    expect(api.calls('GET /api/search')[0]!.query.get('q')).toBe('gumdale');
    expect(where()).toContain('to=153.15000%2C-27.49000%2CGumdale+State+School');
  });

  it('starts from your location when the browser already allows it', async () => {
    allowLocation('granted');
    await renderApp(<DirectionsPanel />, { path: '/directions' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Starting point' })).toHaveValue('Your location'));
  });

  it('never asks for location on its own', async () => {
    allowLocation('prompt');
    await renderApp(<DirectionsPanel />, { path: '/directions' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('combobox', { name: 'Starting point' })).toHaveValue('');
  });

  it('asks for a click on the map when choosing the start there, and can cancel', async () => {
    await renderApp(<DirectionsPanel />, { path: '/directions' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Starting point' }));
    await userEvent.click(screen.getByRole('option', { name: 'Choose on map' }));
    expect(screen.getByText(/Click the map to set the starting point/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Click the map to set/)).not.toBeInTheDocument();
  });
});
