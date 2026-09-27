/** The app's routes and guards, rendered from <App /> at a given URL. */
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Routes, fakeApi, reply } from './fakeApi';
import { useFakeMap } from './fakeMap';
import { auth, config, coverageStats, user } from './fixtures';

const signedOut = () => reply(401, { error: { code: 'unauthorized', message: 'Sign in' } });

async function openApp(path: string, routes: Routes) {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  const api = fakeApi({ 'GET /api/config': () => config(), ...routes });
  useFakeMap();
  const { App } = await import('../src/App');
  render(<App />);
  return api;
}

const adminEndpoints: Routes = {
  'GET /api/admin/feedback/summary': () => ({ newCount: 2 }),
  'GET /api/admin/health': () => ({ services: [], system: null, osmDataDate: null }),
  'GET /api/admin/system': () => ({ samples: [] }),
  'GET /api/admin/errors': () => ({ groups: [] }),
  'GET /api/admin/stats/usage': () => ({ dau: 1, wau: 1, mau: 1, totalUsers: 1, trackingEnabledUsers: 0, tripsLast7d: 0, byDay: [] }),
  'GET /api/admin/metrics': () => ({ points: [] }),
};

beforeEach(() => window.history.replaceState(null, '', '/'));

describe('App routes', () => {
  it('sends signed-out people to sign in, then back where they were going', async () => {
    await openApp('/coverage', {
      'POST /api/auth/refresh': signedOut,
      'POST /api/auth/login': () => auth(),
      'GET /api/coverage/stats': () => coverageStats(),
    });
    expect(await screen.findByRole('heading', { name: 'Sign in to Wayfinder' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sign-in');
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(window.location.pathname).toBe('/coverage'));
    expect(await screen.findByText('Every road and path you’ve travelled.')).toBeInTheDocument();
  });

  it('opens the planner at Directions for a signed-in person, and keeps them off sign-in', async () => {
    await openApp('/sign-in', { 'POST /api/auth/refresh': () => auth() });
    await waitFor(() => expect(window.location.pathname).toBe('/directions'));
    expect(await screen.findByRole('navigation', { name: 'Planner' })).toBeInTheDocument();
  });

  it('sends unknown addresses to Directions', async () => {
    await openApp('/nowhere', { 'POST /api/auth/refresh': () => auth() });
    await waitFor(() => expect(window.location.pathname).toBe('/directions'));
  });

  it('keeps plain users out of the dashboard', async () => {
    await openApp('/admin', { 'POST /api/auth/refresh': () => auth(user({ role: 'user' })) });
    await waitFor(() => expect(window.location.pathname).toBe('/directions'));
  });

  it('lets devs into a read-only dashboard, with a count of new feedback', async () => {
    await openApp('/admin', { 'POST /api/auth/refresh': () => auth(user({ role: 'dev' })), ...adminEndpoints });
    expect(await screen.findByText('Dev (read-only)')).toBeInTheDocument();
    expect(await screen.findByLabelText('2 new')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('opens the reset page whether or not someone is signed in', async () => {
    await openApp('/reset-password?token=abcdefghijk', { 'POST /api/auth/refresh': () => auth() });
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });

  it('after someone signs out, the next sign-in starts fresh instead of on their page', async () => {
    let signedIn = true;
    await openApp('/coverage', {
      'POST /api/auth/refresh': () => (signedIn ? auth() : signedOut()),
      'POST /api/auth/logout': () => {
        signedIn = false;
        return undefined;
      },
      'POST /api/auth/login': () => auth(user({ email: 'someone-else@example.test' })),
      'GET /api/coverage/stats': () => coverageStats(),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Account:/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    await userEvent.type(await screen.findByLabelText('Email'), 'someone-else@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(window.location.pathname).toBe('/directions'));
  });
});
