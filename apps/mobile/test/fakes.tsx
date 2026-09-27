/**
 * Shared fakes for the Android screen tests. A test file points its jest.mock factories here:
 *
 *   jest.mock('../src/lib/api', () => require('./fakes').apiModule);
 *   jest.mock('../src/lib/session', () => require('./fakes').sessionModule);
 *   jest.mock('../src/lib/appConfig', () => require('./fakes').appConfigModule);
 *   jest.mock('../src/map/MapCanvas', () => require('./fakes').mapCanvasModule);
 *   jest.mock('expo-router', () => require('./fakes').routerModule);
 *
 * then drives them through the exported objects. Endpoints a screen calls that the test didn't
 * declare fail the request, and `fake.api.unhandled` lists them.
 */
/// <reference types="jest" />
import { copyFor } from '@wayfinder/shared/copy';
import type { CoverageStats, DiscoverItem, Place, PublicConfig, PublicUser, Route, TripDetail, TripSummary } from '@wayfinder/shared/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { type ReactElement, type ReactNode, forwardRef, useImperativeHandle } from 'react';
import { Text, View } from 'react-native';
import { user as makeUser } from './mocks';

export interface Init {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
}
type Handler = (init: Init) => unknown;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const fake = {
  api: {
    routes: {} as Record<string, Handler>,
    calls: [] as Array<{ key: string; init: Init }>,
    unhandled: [] as string[],
    /** Declare endpoints as "METHOD path", e.g. "GET api/trips" or "DELETE api/trips/:id". */
    on(routes: Record<string, Handler>) {
      Object.assign(this.routes, routes);
    },
    callsTo(key: string) {
      return this.calls.filter((c) => c.key === key).map((c) => c.init);
    },
  },
  user: makeUser(true) as PublicUser | null,
  status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' | 'offline',
  config: { appName: 'Wayfinder', voice: 'plain', feedbackEnabled: false, osmDataDate: null } as PublicConfig,
  session: {
    setUser: jest.fn((u: PublicUser) => {
      fake.user = u;
    }),
    signIn: jest.fn(async (_email: string, _password: string) => undefined),
    register: jest.fn(async (_code: string, _email: string, _password: string) => undefined),
    signOut: jest.fn(async () => undefined),
    retry: jest.fn(async () => undefined),
  },
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  params: {} as Record<string, string>,
  /** Props the screen last gave the map, and calls made through its handle. */
  map: { props: {} as Record<string, unknown>, fitTo: jest.fn(), flyTo: jest.fn() },
};

export const apiError = (status: number, message: string) => new HttpError(status, message);

export function resetFakes() {
  fake.api.routes = {};
  fake.api.calls = [];
  fake.api.unhandled = [];
  fake.user = makeUser(true);
  fake.status = 'authenticated';
  fake.config = { appName: 'Wayfinder', voice: 'plain', feedbackEnabled: false, osmDataDate: null };
  fake.params = {};
  fake.map.props = {};
  jest.clearAllMocks();
}

function matches(pattern: string, key: string) {
  const a = pattern.split(/[ /]/);
  const b = key.split(/[ /]/);
  return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i]);
}

async function request(path: string, init: Init = {}) {
  const key = `${init.method ?? 'GET'} ${path}`;
  fake.api.calls.push({ key, init });
  const handler = fake.api.routes[key] ?? Object.entries(fake.api.routes).find(([k]) => matches(k, key))?.[1];
  if (!handler) {
    fake.api.unhandled.push(key);
    throw new Error(`No fake for ${key}`);
  }
  const out = await handler(init);
  if (out instanceof HttpError) throw out;
  return out;
}

export const apiModule = {
  api: { request: (path: string, init?: Init) => request(path, init) },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong'),
};

export const sessionModule = {
  useSession: () => ({ status: fake.status, user: fake.user, ...fake.session }),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
};

export const appConfigModule = {
  useAppConfig: () => ({ config: fake.config, copy: copyFor(fake.config.voice) }),
  AppConfigProvider: ({ children }: { children: ReactNode }) => children,
};

export const mapCanvasModule = {
  MapCanvas: forwardRef(function FakeMap(props: Record<string, unknown>, ref) {
    fake.map.props = props;
    useImperativeHandle(ref, () => ({ fitTo: fake.map.fitTo, flyTo: fake.map.flyTo }));
    return <View testID="map" />;
  }),
};

export const routerModule = {
  router: fake.router,
  useLocalSearchParams: () => fake.params,
  Link: ({ children, href }: { children: ReactNode; href: string }) => <Text accessibilityRole="link" onPress={() => fake.router.push(href)}>{children}</Text>,
  Redirect: ({ href }: { href: string }) => <Text>{`Redirect to ${href}`}</Text>,
};

/**
 * Render a screen inside a fresh query client. gcTime Infinity schedules no clean-up timers
 * (a finished mutation otherwise holds a 5-minute timer that keeps Jest from exiting).
 */
export function renderScreen(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// Server responses, typed by the shared schemas.

export const route = (over: Partial<Route> = {}): Route => ({
  id: 'r-fast',
  kind: 'fastest',
  mode: 'car',
  distanceM: 12_300,
  durationS: 900,
  extraDurationS: 0,
  geometry: [
    [153.0, -27.4],
    [153.1, -27.5],
  ],
  instructions: [
    { sign: 0, text: 'Head north on Queen Street', streetName: 'Queen Street', distanceM: 300, durationS: 30, interval: [0, 1] },
    { sign: 4, text: 'Arrive at destination', streetName: '', distanceM: 0, durationS: 0, interval: [1, 1] },
  ],
  viaPoints: [],
  novelty: { totalKm: 12.3, newKm: 0, noveltyPct: 0 },
  ...over,
});

export const place = (over: Partial<Place> = {}): Place => ({
  id: 'p-1',
  name: 'Gumdale State School',
  kind: 'poi',
  typeLabel: 'School',
  context: 'Gumdale QLD 4154',
  description: 'School, Gumdale QLD 4154',
  location: [153.15, -27.49],
  ...over,
});

export const trip = (over: Partial<TripSummary> = {}): TripSummary => ({
  id: 't-1',
  mode: 'car',
  source: 'background',
  startedAt: '2026-09-20T08:00:00.000Z',
  endedAt: '2026-09-20T08:30:00.000Z',
  distanceM: 18_000,
  newRoads: 3,
  ...over,
});

export const tripDetail = (over: Partial<TripDetail> = {}): TripDetail => ({
  ...trip(),
  geometry: [
    [153.0, -27.4],
    [153.1, -27.5],
  ],
  points: [
    { ts: 1, lon: 153.0, lat: -27.4 },
    { ts: 2, lon: 153.05, lat: -27.45 },
    { ts: 3, lon: 153.1, lat: -27.5 },
  ],
  ...over,
});

export const coverageStats = (over: Partial<CoverageStats> = {}): CoverageStats => ({
  roadKm: 412.5,
  roadsTravelled: 1234,
  newRoadsWeek: 17,
  newRoadsMonth: 60,
  byMode: { carKm: 400, footKm: 12.5 },
  firstVisitAt: '2026-08-01T00:00:00.000Z',
  tripCount: 42,
  distanceKm: 980,
  ...over,
});

export const discoverItem = (over: Partial<DiscoverItem> = {}): DiscoverItem => ({
  id: 'd-1',
  name: 'Mount Coot-tha Lookout',
  category: 'viewpoint',
  location: [152.95, -27.48],
  distanceM: 7_400,
  areaUnexploredPct: 80,
  score: 0.9,
  ...over,
});
