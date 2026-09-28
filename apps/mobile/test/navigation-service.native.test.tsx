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
const mockResults: Array<{ state: object; events: object[] }> = [];
jest.mock('@wayfinder/nav', () => ({
  NavigationSession: class {
    mode: string;
    constructor(r: { mode: string }) {
      this.mode = r.mode;
    }
    update() {
      return mockResults.shift() ?? { state: { status: 'navigating' }, events: [] };
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
