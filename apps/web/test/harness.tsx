/**
 * Render a screen the way the app does: query client, config, auth, toasts, planner state and a
 * router, over the fake API and fake map.
 *
 *   const { api, map } = await renderApp(<TripsPanel />, { path: '/trips', api: { 'GET /api/trips': ... } });
 *   expect(where()).toBe('/trips/t-1');   // the current URL, after navigation
 */
import type { PublicConfig, PublicUser } from '@wayfinder/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import type { MapApi } from '../src/map/MapProvider';
import { setSession } from '../src/lib/api';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { ConfigProvider } from '../src/lib/config';
import { ToastProvider } from '../src/lib/toast';
import { PlannerProvider } from '../src/planner/PlannerState';
import { type FakeApi, type Routes, fakeApi, reply } from './fakeApi';
import { type FakeMap, useFakeMap } from './fakeMap';
import { auth, config as makeConfig, user as makeUser } from './fixtures';

export interface RenderOptions {
  /** The URL to open. */
  path?: string;
  /** The route pattern the screen is mounted at (defaults to the path without its query). */
  pattern?: string;
  /** Signed-in user; null for signed out. */
  user?: PublicUser | null;
  config?: Partial<PublicConfig>;
  api?: Routes;
  map?: Partial<MapApi>;
  /** Other routes to mount beside the screen, e.g. where it navigates to. */
  routes?: Array<{ path: string; element: ReactElement }>;
}

/** Mount the screen once the session is known, as the app's RequireAuth does. */
function AfterAuth({ children }: { children: ReactElement }) {
  return useAuth().status === 'loading' ? null : children;
}

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location" hidden>{l.pathname + l.search}</output>;
}

export async function renderApp(ui: ReactElement, opts: RenderOptions = {}): Promise<{ api: FakeApi; map: FakeMap; client: QueryClient }> {
  const u = opts.user === undefined ? makeUser() : opts.user;
  const api = fakeApi({
    'GET /api/config': () => makeConfig(opts.config),
    'POST /api/auth/refresh': () => (u ? auth(u) : reply(401, { error: { code: 'unauthorized', message: 'Sign in' } })),
    ...opts.api,
  });
  const map = useFakeMap(opts.map);
  setSession(null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const path = opts.path ?? '/';
  const pattern = opts.pattern ?? path.split('?')[0]!;
  const withProbe = (el: ReactElement) => (
    <>
      {el}
      <LocationProbe />
    </>
  );
  const router = createMemoryRouter(
    [
      { path: pattern, element: withProbe(ui) },
      ...(opts.routes ?? []).map((r) => ({ path: r.path, element: withProbe(r.element) })),
      { path: '*', element: <LocationProbe /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider>
        <AuthProvider>
          <ToastProvider>
            <AfterAuth>
              <PlannerProvider>
                <RouterProvider router={router} />
              </PlannerProvider>
            </AfterAuth>
          </ToastProvider>
        </AuthProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('location');
  await flush();
  return { api, map, client };
}

/** The router's current path and query. */
export const where = () => screen.getAllByTestId('location').at(-1)!.textContent;

/** Let pending promises and effects run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
