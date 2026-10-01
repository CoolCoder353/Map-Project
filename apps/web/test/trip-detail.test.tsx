import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TripDetailPanel } from '../src/planner/TripDetailPanel';
import { type Routes, apiError } from './fakeApi';
import { tripDetail } from './fixtures';
import { renderApp, where } from './harness';

const open = (api: Routes = {}) =>
  renderApp(<TripDetailPanel />, {
    path: '/trips/t-1',
    pattern: '/trips/:id',
    routes: [{ path: '/trips', element: <p>trip list</p> }],
    api: { 'GET /api/trips/t-1': () => tripDetail(), ...api },
  });

describe('Trip detail', () => {
  it('shows the trip, draws it and fits the map to it', async () => {
    const { map } = await open();
    expect(await screen.findByRole('heading', { name: 'Drive · 18 km' })).toBeInTheDocument();
    expect(screen.getByText('3 roads you’d never travelled before')).toBeInTheDocument();
    expect(map.fitTo).toHaveBeenCalledWith(tripDetail().geometry);
    // Replay starts at the end: the whole trip travelled.
    expect(map.setTrack).toHaveBeenLastCalledWith(
      [[153, -27.4], [153.05, -27.45], [153.1, -27.5]],
      [[153, -27.4], [153.05, -27.45], [153.1, -27.5]],
    );
    expect(map.setMarkers).toHaveBeenLastCalledWith([
      { id: 'start', lngLat: [153, -27.4], kind: 'start' },
      { id: 'pos', lngLat: [153.1, -27.5], kind: 'position' },
    ]);
  });

  it('scrubs the replay', async () => {
    const { map } = await open();
    const slider = await screen.findByRole('slider', { name: 'Replay position' });
    fireEvent.change(slider, { target: { value: '500' } });
    expect(map.setTrack).toHaveBeenLastCalledWith(expect.any(Array), [[153, -27.4], [153.05, -27.45]]);
    fireEvent.change(slider, { target: { value: '0' } });
    expect(map.setTrack).toHaveBeenLastCalledWith(expect.any(Array), [[153, -27.4]]);
  });

  it('plays the replay from the start and pauses', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Play replay' }));
    const slider = screen.getByRole('slider', { name: 'Replay position' });
    await waitFor(() => expect(Number(slider.getAttribute('value') ?? (slider as HTMLInputElement).value)).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    const at = (slider as HTMLInputElement).value;
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect((slider as HTMLInputElement).value).toBe(at);
  });

  it('replays at a chosen multiple of real time, showing the speed at each moment', async () => {
    await open();
    // The 30-minute trip at the usual 60 times real time.
    expect(await screen.findByText('This trip replays in 30 s.')).toBeInTheDocument();
    expect(screen.getByLabelText('Speed then: 30 km/h')).toBeInTheDocument();
    const rate = screen.getByRole('slider', { name: /Replay speed/ });
    fireEvent.change(rate, { target: { value: '5' } });
    expect(rate).toHaveAttribute('aria-valuetext', '600 times real time');
    expect(screen.getByText('This trip replays in 3 s.')).toBeInTheDocument();
    fireEvent.change(rate, { target: { value: '0' } });
    expect(screen.getByText('This trip replays in 3 min.')).toBeInTheDocument();
    fireEvent.change(rate, { target: { value: '5' } });

    const position = screen.getByRole('slider', { name: 'Replay position' }) as HTMLInputElement;
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
      // Half of the 3 seconds: half of the trip.
      act(() => vi.advanceTimersByTime(1500));
      expect(Number(position.value)).toBeGreaterThan(450);
      expect(Number(position.value)).toBeLessThan(550);
    } finally {
      vi.useRealTimers();
    }
  });

  it('corrects the recorded mode', async () => {
    const { api } = await open({ 'PATCH /api/trips/t-1': () => ({ ok: true }) });
    await userEvent.click(await screen.findByRole('radio', { name: 'Walk' }));
    expect(await screen.findByText('Mode updated. Your coverage will refresh shortly.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/trips/t-1')[0]!.body).toEqual({ mode: 'foot' });
    // Choosing the mode it already has does nothing.
    await userEvent.click(screen.getByRole('radio', { name: 'Drive' }));
    expect(api.calls('PATCH /api/trips/t-1')).toHaveLength(1);
  });

  it('deletes after confirming, and goes back to the list', async () => {
    const { api } = await open({ 'DELETE /api/trips/t-1': () => undefined });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this trip?' });
    expect(dialog).toHaveTextContent('recovered for 7 days');
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete trip' }).at(-1)!);
    await waitFor(() => expect(where()).toBe('/trips'));
    expect(api.calls('DELETE /api/trips/t-1')).toHaveLength(1);
    expect(screen.getByText(/Trip deleted/)).toBeInTheDocument();
  });

  it('can back out of deleting, and shows a failed delete', async () => {
    const { api } = await open({ 'DELETE /api/trips/t-1': () => apiError(409, 'conflict', 'Already deleted') });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete trip' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete trip' }).at(-1)!);
    expect(await screen.findByText('Already deleted')).toBeInTheDocument();
    expect(api.calls('DELETE /api/trips/t-1')).toHaveLength(1);
    expect(where()).toBe('/trips/t-1');
  });

  it('says when a trip can’t be found', async () => {
    await open({ 'GET /api/trips/t-1': () => apiError(404, 'not_found', 'Trip not found') });
    expect(await screen.findByText('Trip not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'All trips' }));
    expect(where()).toBe('/trips');
  });
});
