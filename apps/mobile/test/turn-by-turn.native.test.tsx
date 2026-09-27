/// <reference types="jest" />
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { REROUTE_RETRY_MS, useTurnByTurn } from '../src/nav/useTurnByTurn';
import { fake, resetFakes, route } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'session-1' }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
const mockRemove = jest.fn();
let mockOnFix: ((loc: unknown) => void) | null = null;
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  watchPositionAsync: jest.fn(async (_opts: unknown, cb: (loc: unknown) => void) => {
    mockOnFix = cb;
    return { remove: mockRemove };
  }),
}));
const mockAppend = jest.fn(async (_points: unknown[]) => undefined);
jest.mock('../src/tracking/sqliteStore', () => ({ sqliteQueueStore: { append: (p: unknown[]) => mockAppend(p) } }));
const mockSync = jest.fn(async () => null);
jest.mock('../src/tracking/sync', () => ({ syncQueue: () => mockSync() }));

// A scripted navigation engine: each fix returns the next queued result.
const mockResults: Array<{ state: object; events: object[] }> = [];
const mockReplaced: unknown[] = [];
jest.mock('@wayfinder/nav', () => ({
  NavigationSession: class {
    mode: string;
    constructor(r: { mode: string; geometry: unknown[] }) {
      if (r.geometry.length < 2) throw new Error('Route geometry needs at least two points');
      this.mode = r.mode;
    }
    update() {
      return mockResults.shift() ?? { state: { status: 'navigating' }, events: [] };
    }
    replaceRoute(r: unknown) {
      mockReplaced.push(r);
    }
  },
}));

const fix = (lon: number, lat: number) => ({ timestamp: 1000, coords: { longitude: lon, latitude: lat, accuracy: 5, speed: 10, heading: 90 } });

beforeEach(() => {
  resetFakes();
  mockResults.length = 0;
  mockReplaced.length = 0;
  mockOnFix = null;
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
});

it('does nothing without a route', async () => {
  const { result } = await renderHook(() => useTurnByTurn(null));
  expect(result.current.route).toBeNull();
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

it('keeps the screen awake, follows GPS, speaks, and records the trip as navigation', async () => {
  const r = route({ mode: 'foot' });
  const { result, unmount } = await renderHook(() => useTurnByTurn(r));
  expect(activateKeepAwakeAsync).toHaveBeenCalledWith('wayfinder-navigation');
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'navigating', remainingDistanceM: 900 }, events: [{ type: 'announce', text: 'In 200 metres, turn left' }] });
  await act(async () => mockOnFix!(fix(153, -27.4)));
  expect(result.current.position).toEqual([153, -27.4]);
  expect(result.current.state).toMatchObject({ remainingDistanceM: 900 });
  expect(Speech.speak).toHaveBeenCalledWith('In 200 metres, turn left', expect.objectContaining({ language: 'en-AU' }));
  expect(mockAppend.mock.calls[0]![0]).toEqual([
    { ts: 1000, lon: 153, lat: -27.4, accuracyM: 5, speedMps: 10, headingDeg: 90, source: 'navigation', mode: 'foot', sessionId: 'session-1' },
  ]);
  await unmount();
  expect(mockRemove).toHaveBeenCalled();
  expect(deactivateKeepAwake).toHaveBeenCalledWith('wayfinder-navigation');
  expect(mockSync).toHaveBeenCalled();
});

it('stays quiet when muted, and uploads on arrival', async () => {
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  await act(async () => result.current.setMuted(true));
  mockResults.push({ state: { status: 'arrived' }, events: [{ type: 'announce', text: 'Turn right' }, { type: 'arrived' }] });
  await act(async () => mockOnFix!(fix(153.1, -27.5)));
  expect(Speech.speak).not.toHaveBeenCalled();
  expect(mockSync).toHaveBeenCalled();
});

it('reroutes after going off route, from where you are to what is left', async () => {
  const next = route({ id: 'r-new' });
  fake.api.on({ 'POST api/routes/fastest': () => next });
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  await act(async () => mockOnFix!(fix(153.2, -27.4)));
  await waitFor(() => expect(result.current.route?.id).toBe('r-new'));
  expect(fake.api.callsTo('POST api/routes/fastest')[0]!.body).toEqual({ from: [153.2, -27.4], to: [153.1, -27.5], via: [], mode: 'car' });
  expect(mockReplaced).toEqual([next]);
  expect(result.current.rerouting).toBe(false);
  expect(Speech.speak).toHaveBeenCalledWith('Route updated', expect.anything());
});

it('keeps going on the old route when rerouting fails offline', async () => {
  fake.api.on({ 'POST api/routes/fastest': () => { throw new Error('offline'); } });
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  await act(async () => mockOnFix!(fix(153.2, -27.4)));
  await waitFor(() => expect(result.current.error).toMatch(/Couldn’t get a new route/));
  expect(result.current.route?.id).toBe('r-fast');
});

it('explains when location permission is refused', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(result.current.error).toBe('Navigation needs location permission.'));
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

it('stop() ends location updates and speech', async () => {
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  result.current.stop();
  expect(mockRemove).toHaveBeenCalled();
  expect(Speech.stop).toHaveBeenCalled();
});

it('explains a route too short to follow instead of crashing', async () => {
  const { result } = await renderHook(() => useTurnByTurn(route({ geometry: [[153, -27.4]] })));
  await waitFor(() => expect(result.current.error).toMatch(/can’t be followed/));
  expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});

it('stops GPS at once if navigation ends while it was still starting', async () => {
  let started: (sub: { remove(): void }) => void = () => undefined;
  jest.mocked(Location.watchPositionAsync).mockImplementationOnce(() => new Promise((resolve) => (started = resolve as never)));
  const { unmount } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalled());
  await unmount();
  const late = { remove: jest.fn() };
  await act(async () => started(late));
  expect(late.remove).toHaveBeenCalled();
});

it('says so when location is switched off', async () => {
  jest.mocked(Location.watchPositionAsync).mockRejectedValueOnce(new Error('Location services are disabled'));
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(result.current.error).toMatch(/Check that location is switched on/));
});

it('asks again for a new route while still off route, and clears the warning once back on it', async () => {
  let fail = true;
  fake.api.on({
    'POST api/routes/fastest': () => {
      if (fail) throw new Error('offline');
      return route({ id: 'r-new' });
    },
  });
  // Shift the clock rather than freeze it: waitFor keeps time with Date.now too.
  const realNow = Date.now.bind(Date);
  let ahead = 0;
  const now = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead);
  const r = route(); // one route object, as the Navigate screen holds it
  const { result } = await renderHook(() => useTurnByTurn(r));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  await act(async () => mockOnFix!(fix(153.2, -27.4)));
  await waitFor(() => expect(result.current.error).toMatch(/Couldn’t get a new route/));
  // Too soon: no second request yet.
  mockResults.push({ state: { status: 'offRoute' }, events: [] });
  await act(async () => mockOnFix!(fix(153.21, -27.4)));
  expect(fake.api.callsTo('POST api/routes/fastest')).toHaveLength(1);
  // Later, from where you are now.
  fail = false;
  ahead = REROUTE_RETRY_MS;
  mockResults.push({ state: { status: 'offRoute' }, events: [] });
  await act(async () => mockOnFix!(fix(153.22, -27.4)));
  await waitFor(() => expect(result.current.route?.id).toBe('r-new'));
  expect(fake.api.callsTo('POST api/routes/fastest')[1]!.body).toMatchObject({ from: [153.22, -27.4], to: [153.1, -27.5] });
  expect(result.current.error).toBeNull();
  now.mockRestore();
});

it('drops the reroute warning when you find your own way back to the route', async () => {
  fake.api.on({ 'POST api/routes/fastest': () => { throw new Error('offline'); } });
  const r = route();
  const { result } = await renderHook(() => useTurnByTurn(r));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  await act(async () => mockOnFix!(fix(153.2, -27.4)));
  await waitFor(() => expect(result.current.error).not.toBeNull());
  mockResults.push({ state: { status: 'navigating' }, events: [{ type: 'backOnRoute' }] });
  await act(async () => mockOnFix!(fix(153.05, -27.45)));
  expect(result.current.error).toBeNull();
});

it('ignores a fix without a usable position', async () => {
  const { result } = await renderHook(() => useTurnByTurn(route()));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  await act(async () => mockOnFix!(fix(Number.NaN, -27.4)));
  expect(result.current.position).toBeNull();
  expect(mockAppend).not.toHaveBeenCalled();
});
