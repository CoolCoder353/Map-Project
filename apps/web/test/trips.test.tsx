import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TripsPanel } from '../src/planner/TripsPanel';
import { apiError } from './fakeApi';
import { trip } from './fixtures';
import { renderApp, where } from './harness';

describe('Trips panel', () => {
  it('groups trips by day with mode, distance, duration and new roads', async () => {
    await renderApp(<TripsPanel />, {
      path: '/trips',
      api: {
        'GET /api/trips': () => ({
          items: [
            trip(),
            trip({ id: 't-2', mode: 'foot', source: 'navigation', startedAt: '2026-09-19T01:00:00.000Z', endedAt: '2026-09-19T01:45:00.000Z', distanceM: 3200, newRoads: 1 }),
            trip({ id: 't-3', startedAt: '2026-09-19T05:00:00.000Z', endedAt: '2026-09-19T05:10:00.000Z', newRoads: 0 }),
          ],
          nextCursor: null,
        }),
      },
    });
    const days = await screen.findAllByRole('region');
    expect(days).toHaveLength(2);
    expect(within(days[0]!).getByText(/3 new roads/)).toBeInTheDocument();
    const walk = within(days[1]!).getAllByRole('link')[0]!;
    expect(walk).toHaveTextContent('Walk, 45 min');
    expect(walk).toHaveTextContent('Navigated');
    expect(walk).toHaveTextContent('1 new road');
    expect(within(days[1]!).getAllByRole('link')[1]).not.toHaveTextContent(/new road/);
    await userEvent.click(within(days[0]!).getByRole('link'));
    expect(where()).toBe('/trips/t-1');
  });

  it('pages back through older trips', async () => {
    const { api } = await renderApp(<TripsPanel />, {
      path: '/trips',
      api: {
        'GET /api/trips': (req) =>
          req.query.get('cursor') === 'c2' ? { items: [trip({ id: 't-old', startedAt: '2026-08-01T00:00:00.000Z', endedAt: '2026-08-01T01:00:00.000Z' })], nextCursor: null } : { items: [trip()], nextCursor: 'c2' },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Load older trips' }));
    expect(await screen.findAllByRole('region')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load older trips' })).not.toBeInTheDocument();
    expect(api.calls('GET /api/trips').map((r) => r.query.get('cursor'))).toEqual([null, 'c2']);
  });

  it('says when there are no trips yet, or when they could not load', async () => {
    await renderApp(<TripsPanel />, { path: '/trips', api: { 'GET /api/trips': () => ({ items: [], nextCursor: null }) } });
    expect(await screen.findByText(/No trips yet|no trips/i)).toBeInTheDocument();
  });

  it('shows an error when trips fail to load', async () => {
    await renderApp(<TripsPanel />, { path: '/trips', api: { 'GET /api/trips': () => apiError(500, 'internal', 'Boom') } });
    expect(await screen.findByText('Couldn’t load trips.')).toBeInTheDocument();
  });
});
