/// <reference types="jest" />
import { waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { navigation, REROUTE_RETRY_MS, REROUTE_TIMEOUT_MS } from '../src/nav/navigationService';
import { isNavigationRecording } from '../src/tracking/navigationRecording';
import { fake, resetFakes, route } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `session-${++mockUuid}` }));
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
jest.mock('../src/nav/navigationLocation', () => ({
  startNavigationLocation: jest.fn(async () => undefined),
  stopNavigationLocation: jest.fn(async () => undefined),
  setNavigationFixHandler: jest.fn(),
}));
const mockAskForNotifications = jest.fn(async () => true);
jest.mock('../src/lib/notifications', () => ({ askForNotifications: () => mockAskForNotifications() }));
import * as NavLocation from '../src/nav/navigationLocation';

// Registered once when navigationService loads, before resetFakes() clears mock records.
const mockFeed = jest.mocked(NavLocation.setNavigationFixHandler).mock.calls[0]![0]!;
const stopsAtLoad = jest.mocked(NavLocation.stopNavigationLocation).mock.calls.length;
const mockResults: Array<{ state: object; events: object[] } | Error> = [];
jest.mock('@wayfinder/nav', () => ({
  NavigationSession: class {
    mode: string;
    constructor(r: { mode: string }) {
      this.mode = r.mode;
    }
    update() {
      const next = mockResults.shift();
      if (next instanceof Error) throw next;
      return next ?? { state: { status: 'navigating' }, events: [] };
    }
    replaceRoute() {}
  },
}));

const fix = (lon: number, lat: number, ts = 1000) => ({ timestamp: ts, coords: { longitude: lon, latitude: lat, accuracy: 5, speed: 10, heading: 90 } });

beforeEach(() => {
  resetFakes();
  mockResults.length = 0;
  mockOnFix = null;
});
afterEach(() => navigation.stop());

it('navigates with no screen open, as the car starts it', async () => {
  let changes = 0;
  const off = navigation.subscribe(() => changes++);
  navigation.start(route({ id: 'r1' }), { destinationName: 'Mt Coot-tha Lookout' });
  expect(navigation.getSnapshot()).toMatchObject({ active: true, route: { id: 'r1' }, destinationName: 'Mt Coot-tha Lookout', state: null });
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'navigating', remainingDistanceM: 500 }, events: [{ type: 'announce', text: 'Turn left' }] });
  mockOnFix!(fix(153, -27.4));
  expect(navigation.getSnapshot()).toMatchObject({ position: [153, -27.4], headingDeg: 90, state: { remainingDistanceM: 500 } });
  expect(Speech.speak).toHaveBeenCalledWith('Turn left', expect.anything());
  expect(changes).toBeGreaterThanOrEqual(2);
  off();
});

// Android 13+ hides "Navigating to …" without permission; the phone asks, the car never does.
it('asks for notifications for a trip started on the phone, after location, and never for the car', async () => {
  navigation.start(route({ id: 'r1' }), { destinationName: 'Mt Coot-tha Lookout' });
  await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalled());
  expect(mockAskForNotifications).not.toHaveBeenCalled();
  navigation.stop();
  navigation.start(route({ id: 'r2' }), { askForNotifications: true });
  await waitFor(() => expect(mockAskForNotifications).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalledTimes(2));
});

it('a trip ended while the notification question is up starts no location service', async () => {
  let answer!: (v: boolean) => void;
  mockAskForNotifications.mockImplementationOnce(() => new Promise<boolean>((r) => (answer = r)));
  navigation.start(route({ id: 'r1' }), { askForNotifications: true });
  await waitFor(() => expect(mockAskForNotifications).toHaveBeenCalled());
  navigation.stop();
  answer(true);
  await new Promise((r) => setTimeout(r, 0));
  expect(NavLocation.startNavigationLocation).not.toHaveBeenCalled();
});

it('starting another trip ends the first and records the new one separately', async () => {
  navigation.start(route({ id: 'r1' }));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!(fix(153, -27.4));
  const first = (mockAppend.mock.calls[0]![0] as Array<{ sessionId: string }>)[0]!.sessionId;
  mockOnFix = null;
  navigation.start(route({ id: 'r2' }));
  expect(mockRemove).toHaveBeenCalled();
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!(fix(153.1, -27.4));
  const second = (mockAppend.mock.calls[1]![0] as Array<{ sessionId: string }>)[0]!.sessionId;
  expect(second).not.toBe(first);
  expect(navigation.getSnapshot().route?.id).toBe('r2');
});

it('stop() clears everything, uploads what was recorded, and is safe to repeat', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  navigation.stop();
  navigation.stop();
  expect(navigation.getSnapshot()).toMatchObject({ active: false, route: null, state: null });
  expect(mockSync).toHaveBeenCalledTimes(1);
});

it('ignores fixes once navigation has ended', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  const late = mockOnFix!;
  navigation.stop();
  late(fix(153, -27.4));
  expect(navigation.getSnapshot().position).toBeNull();
  expect(mockAppend).not.toHaveBeenCalled();
});

it('keeps a location service running for the trip, named after the destination', async () => {
  navigation.start(route(), { destinationName: 'Mt Coot-tha Lookout' });
  await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalledWith('Mt Coot-tha Lookout'));
  navigation.stop();
  expect(NavLocation.stopNavigationLocation).toHaveBeenCalled();
});

it('stops a location service that only finishes starting after the trip has ended', async () => {
  let resolveStart: () => void = () => undefined;
  jest.mocked(NavLocation.startNavigationLocation).mockImplementationOnce(() => new Promise((resolve) => (resolveStart = resolve)));
  navigation.start(route());
  await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalled());
  navigation.stop();
  const callsBefore = jest.mocked(NavLocation.stopNavigationLocation).mock.calls.length;
  resolveStart();
  await waitFor(() => expect(jest.mocked(NavLocation.stopNavigationLocation).mock.calls.length).toBeGreaterThan(callsBefore));
});

it('still navigates when the location service cannot start', async () => {
  jest.mocked(NavLocation.startNavigationLocation).mockRejectedValueOnce(new Error('no'));
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  expect(navigation.getSnapshot().error).toBeNull();
});

it('follows fixes from the location service, skipping ones the GPS watch already gave', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!(fix(153, -27.4, 5000));
  mockFeed([fix(153, -27.4, 5000) as never, fix(153.01, -27.4, 6000) as never]);
  expect(mockAppend).toHaveBeenCalledTimes(2);
  expect(navigation.getSnapshot().position).toEqual([153.01, -27.4]);
});

it('keeps the last position but skips recording a fix the route engine could not match', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push(new Error('off the end of the route'));
  mockOnFix!(fix(153, -27.4, 5000));
  expect(navigation.getSnapshot()).toMatchObject({ position: [153, -27.4] });
  expect(mockAppend).not.toHaveBeenCalled();
  // The next fix carries on as normal.
  mockOnFix!(fix(153.01, -27.41, 6000));
  expect(mockAppend).toHaveBeenCalledTimes(1);
});

it('keeps the fix even when the local write to disk fails', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockAppend.mockRejectedValueOnce(new Error('disk full'));
  mockOnFix!(fix(153, -27.4, 5000));
  await waitFor(() => expect(mockAppend).toHaveBeenCalledTimes(1));
  expect(navigation.getSnapshot().position).toEqual([153, -27.4]);
});

it('still finishes stopping when turning off the location service and the last upload both fail', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  jest.mocked(NavLocation.stopNavigationLocation).mockRejectedValueOnce(new Error('no'));
  mockSync.mockRejectedValueOnce(new Error('offline'));
  navigation.stop();
  expect(navigation.getSnapshot()).toMatchObject({ active: false, route: null, state: null });
  // Let the swallowed rejections settle before the test ends.
  await Promise.resolve();
  await Promise.resolve();
});

it('switches off a location service left running by a trip the app never got to end', () => {
  // Android restarts a registered location task when the app next starts (after being swiped
  // away mid-trip, say), but no trip can be running when the app's code has only just loaded.
  expect(stopsAtLoad).toBe(1);
});

it('keeps the newer trip’s location service running when a second trip starts while the first one’s is starting', async () => {
  const started: Array<() => void> = [];
  jest.mocked(NavLocation.startNavigationLocation).mockImplementation(() => new Promise<void>((resolve) => started.push(resolve)));
  try {
    navigation.start(route({ id: 'a' }), { destinationName: 'A' });
    await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalledWith('A'));
    navigation.start(route({ id: 'b' }), { destinationName: 'B' });
    started[0]!();
    await waitFor(() => expect(NavLocation.startNavigationLocation).toHaveBeenCalledWith('B'));
    started[1]!();
    await new Promise((resolve) => setImmediate(resolve));
    const lastStart = jest.mocked(NavLocation.startNavigationLocation).mock.invocationCallOrder.at(-1)!;
    expect(jest.mocked(NavLocation.stopNavigationLocation).mock.invocationCallOrder.filter((order) => order > lastStart)).toEqual([]);
    expect(navigation.getSnapshot().route?.id).toBe('b');
  } finally {
    jest.mocked(NavLocation.startNavigationLocation).mockImplementation(async () => undefined);
  }
});

it('gives up on a new route that never comes (the phone locked mid-request), says so, and asks again later', async () => {
  let lateAnswer: (r: unknown) => void = () => undefined;
  let asked = 0;
  fake.api.on({
    'POST api/routes/fastest': () => (++asked === 1 ? new Promise((resolve) => (lateAnswer = resolve)) : route({ id: 'r-new' })),
  });
  // Shift the clock rather than freeze it: waitFor keeps time with Date.now too.
  const realNow = Date.now.bind(Date);
  let ahead = 0;
  const now = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead);
  try {
    navigation.start(route());
    await waitFor(() => expect(mockOnFix).not.toBeNull());
    mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
    mockOnFix!(fix(153.2, -27.4, 1000));
    expect(navigation.getSnapshot().rerouting).toBe(true);
    // No timer fires while the phone is locked; the next fix is what notices.
    ahead = REROUTE_TIMEOUT_MS;
    mockResults.push({ state: { status: 'offRoute' }, events: [] });
    mockOnFix!(fix(153.21, -27.4, 2000));
    expect(navigation.getSnapshot()).toMatchObject({ rerouting: false, error: expect.stringMatching(/Couldn’t get a new route/) });
    // The abandoned request answering after all changes nothing.
    lateAnswer(route({ id: 'r-late' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(navigation.getSnapshot()).toMatchObject({ route: { id: 'r-fast' }, rerouting: false });
    // Not straight away...
    mockResults.push({ state: { status: 'offRoute' }, events: [] });
    mockOnFix!(fix(153.215, -27.4, 2500));
    expect(asked).toBe(1);
    // ...but a little later, from where you are then.
    ahead = REROUTE_TIMEOUT_MS + REROUTE_RETRY_MS;
    mockResults.push({ state: { status: 'offRoute' }, events: [] });
    mockOnFix!(fix(153.22, -27.4, 3000));
    await waitFor(() => expect(navigation.getSnapshot().route?.id).toBe('r-new'));
    expect(fake.api.callsTo('POST api/routes/fastest')[1]!.body).toMatchObject({ from: [153.22, -27.4], to: [153.1, -27.5] });
    expect(navigation.getSnapshot().error).toBeNull();
  } finally {
    now.mockRestore();
  }
});

it('drops a GPS watch fix the location service already gave', async () => {
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockFeed([fix(153, -27.4, 5000) as never]);
  mockOnFix!(fix(153, -27.4, 5000));
  expect(mockAppend).toHaveBeenCalledTimes(1);
  // A newer one from the watch is followed as usual.
  mockOnFix!(fix(153.01, -27.4, 6000));
  expect(mockAppend).toHaveBeenCalledTimes(2);
});

it('gives up quietly on a new route that never comes once you are back on the old one', async () => {
  fake.api.on({ 'POST api/routes/fastest': () => new Promise(() => undefined) });
  const realNow = Date.now.bind(Date);
  let ahead = 0;
  const now = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead);
  try {
    navigation.start(route());
    await waitFor(() => expect(mockOnFix).not.toBeNull());
    mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
    mockOnFix!(fix(153.2, -27.4, 1000));
    mockResults.push({ state: { status: 'navigating' }, events: [{ type: 'backOnRoute' }] });
    mockOnFix!(fix(153.05, -27.45, 2000));
    expect(navigation.getSnapshot().rerouting).toBe(true);
    ahead = REROUTE_TIMEOUT_MS;
    mockOnFix!(fix(153.06, -27.45, 3000));
    expect(navigation.getSnapshot()).toMatchObject({ rerouting: false, error: null });
  } finally {
    now.mockRestore();
  }
});

it('asks for a new route that starts the way you are driving, not back the way you came', async () => {
  fake.api.on({ 'POST api/routes/fastest': () => route({ id: 'r-new' }) });
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  // Driving west at 10 m/s: the phone's heading says so.
  mockOnFix!({ timestamp: 1000, coords: { longitude: 153.2, latitude: -27.4, accuracy: 5, speed: 10, heading: 270 } });
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.199, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  mockOnFix!({ timestamp: 2000, coords: { longitude: 153.199, latitude: -27.4, accuracy: 5, speed: 10, heading: 270 } });
  await waitFor(() => expect(navigation.getSnapshot().route?.id).toBe('r-new'));
  expect(fake.api.callsTo('POST api/routes/fastest')[0]!.body).toMatchObject({ heading: 270 });
});

it('works out the direction from movement when the phone gives no heading', async () => {
  fake.api.on({ 'POST api/routes/fastest': () => route({ id: 'r-new' }) });
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  const still = (lon: number, lat: number, ts: number) => ({ timestamp: ts, coords: { longitude: lon, latitude: lat, accuracy: 5, speed: null, heading: null } });
  mockOnFix!(still(153.2, -27.4, 1000));
  // About 110 m due south.
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.401], to: [153.1, -27.5], remainingVia: [] }] });
  mockOnFix!(still(153.2, -27.401, 2000));
  await waitFor(() => expect(navigation.getSnapshot().route?.id).toBe('r-new'));
  expect((fake.api.callsTo('POST api/routes/fastest')[0]!.body as { heading: number }).heading).toBeCloseTo(180, 0);
});

it('sends no direction before it is known, or on foot', async () => {
  fake.api.on({ 'POST api/routes/fastest': () => route({ id: 'r-new' }) });
  navigation.start(route());
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.2, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  mockOnFix!({ timestamp: 1000, coords: { longitude: 153.2, latitude: -27.4, accuracy: 5, speed: 0, heading: 0 } });
  await waitFor(() => expect(navigation.getSnapshot().route?.id).toBe('r-new'));
  expect(fake.api.callsTo('POST api/routes/fastest')[0]!.body).not.toHaveProperty('heading');

  navigation.start(route({ id: 'walk', mode: 'foot' }));
  await waitFor(() => expect(mockOnFix).not.toBeNull());
  mockOnFix!({ timestamp: 3000, coords: { longitude: 153.2, latitude: -27.4, accuracy: 5, speed: 3, heading: 90 } });
  mockResults.push({ state: { status: 'offRoute' }, events: [{ type: 'offRoute', from: [153.201, -27.4], to: [153.1, -27.5], remainingVia: [] }] });
  mockOnFix!({ timestamp: 4000, coords: { longitude: 153.201, latitude: -27.4, accuracy: 5, speed: 3, heading: 90 } });
  await waitFor(() => expect(fake.api.callsTo('POST api/routes/fastest')).toHaveLength(2));
  expect(fake.api.callsTo('POST api/routes/fastest')[1]!.body).not.toHaveProperty('heading');
});

it('pauses background recording for the length of a navigated trip', async () => {
  expect(isNavigationRecording()).toBe(false);
  navigation.start(route());
  expect(isNavigationRecording()).toBe(true);
  navigation.stop();
  expect(isNavigationRecording()).toBe(false);
});
