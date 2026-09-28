/// <reference types="jest" />
import { waitFor } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { navigation } from '../src/nav/navigationService';
import { resetFakes, route } from './fakes';

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
import * as NavLocation from '../src/nav/navigationLocation';

// Registered once when navigationService loads, before resetFakes() clears mock records.
const mockFeed = jest.mocked(NavLocation.setNavigationFixHandler).mock.calls[0]![0]!;
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
