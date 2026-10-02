/// <reference types="jest" />
import * as Speech from 'expo-speech';
import { RouteSchema } from '@wayfinder/shared/schemas';
import { haversineM } from '@wayfinder/shared/geo';
import { createNavigationService } from '../src/nav/navigationService';
import { cancelTestDrive, DEMO_ORIGIN, demoRoute, startTestDrive } from '../src/car/simulation';
import { toCarNav } from '../src/car/navModel';
import { isNavigationRecording } from '../src/tracking/navigationRecording';

// The real navigation engine and service: a test drive is only worth testing against the real thing.
jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'session-1' }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
const mockWatch = jest.fn(async () => ({ remove: jest.fn() }));
const mockPermission = jest.fn(async () => ({ granted: true }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: () => mockPermission(),
  watchPositionAsync: () => mockWatch(),
}));
const mockAppend = jest.fn(async (_p: unknown[]) => undefined);
jest.mock('../src/tracking/sqliteStore', () => ({ sqliteQueueStore: { append: (p: unknown[]) => mockAppend(p) } }));
const mockSync = jest.fn(async () => null);
jest.mock('../src/tracking/sync', () => ({ syncQueue: () => mockSync() }));
jest.mock('../src/nav/navigationLocation', () => ({
  startNavigationLocation: jest.fn(async () => undefined),
  stopNavigationLocation: jest.fn(async () => undefined),
  setNavigationFixHandler: jest.fn(),
}));
import * as NavLocation from '../src/nav/navigationLocation';

const nav = createNavigationService();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  cancelTestDrive();
  nav.stop();
  jest.useRealTimers();
});

/** Runs the drive: one fix a second until it arrives (or [maxSeconds] pass). */
function drive(maxSeconds = 300) {
  for (let s = 0; s < maxSeconds && nav.getSnapshot().state?.status !== 'arrived'; s++) jest.advanceTimersByTime(1000);
}

describe('the built-in route', () => {
  it('is a valid route that starts where it is told, in [lon, lat] order', () => {
    const r = demoRoute();
    expect(RouteSchema.parse(r)).toBeTruthy();
    expect(r.geometry[0]).toEqual(DEMO_ORIGIN);
    // Brisbane: longitude near 153, latitude near -27.
    expect(r.geometry[0]![0]).toBeGreaterThan(150);
    expect(r.geometry[0]![1]).toBeLessThan(-20);
    const here: [number, number] = [149.1, -35.3];
    expect(demoRoute(here).geometry[0]).toEqual(here);
  });

  it('is short: a couple of kilometres, with a turn in it', () => {
    const r = demoRoute();
    expect(r.distanceM).toBeGreaterThan(1500);
    expect(r.distanceM).toBeLessThan(3000);
    expect(r.instructions.map((i) => i.sign)).toEqual([0, -2, 4]);
  });
});

describe('a test drive', () => {
  it('gives the directions a real trip would, then arrives', () => {
    const seen: string[] = [];
    nav.subscribe(() => {
      const model = toCarNav(nav.getSnapshot(), 0);
      if (model && model.cue && seen.at(-1) !== model.cue) seen.push(model.cue);
    });
    startTestDrive(nav, demoRoute(), 'Test drive');
    drive();
    expect(nav.getSnapshot().state?.status).toBe('arrived');
    expect(seen).toContain('Turn left onto Demo Road');
    const spoken = jest.mocked(Speech.speak).mock.calls.map((c) => c[0]);
    expect(spoken).toEqual(expect.arrayContaining([expect.stringMatching(/turn left onto Demo Road/i), 'You have arrived']));
    expect(nav.getSnapshot()).toMatchObject({ active: true, destinationName: 'Test drive' });
  });

  it('is short whatever the route: about a minute and a half, never minutes of waiting', () => {
    startTestDrive(nav, demoRoute(), null);
    let seconds = 0;
    while (nav.getSnapshot().state?.status !== 'arrived' && seconds < 600) {
      jest.advanceTimersByTime(1000);
      seconds++;
    }
    expect(seconds).toBeGreaterThan(30);
    expect(seconds).toBeLessThan(120);
  });

  it('records nothing, uploads nothing, and never touches the phone’s location', async () => {
    startTestDrive(nav, demoRoute(), 'Test drive');
    drive();
    nav.stop();
    await Promise.resolve();
    expect(mockAppend).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(isNavigationRecording()).toBe(false);
    expect(mockPermission).not.toHaveBeenCalled();
    expect(mockWatch).not.toHaveBeenCalled();
    expect(NavLocation.startNavigationLocation).not.toHaveBeenCalled();
  });

  it('follows its own fixes and ignores the phone’s real position', () => {
    startTestDrive(nav, demoRoute(), null);
    jest.advanceTimersByTime(3000);
    const before = nav.getSnapshot().position;
    nav.handleFix({ timestamp: Date.now() + 10_000, coords: { longitude: 10, latitude: 10, accuracy: 5, speed: 10, heading: 0 } } as never, 'watch');
    nav.handleFix({ timestamp: Date.now() + 20_000, coords: { longitude: 10, latitude: 10, accuracy: 5, speed: 10, heading: 0 } } as never, 'service');
    expect(nav.getSnapshot().position).toEqual(before);
    expect(haversineM(before!, DEMO_ORIGIN)).toBeLessThan(500);
  });

  it('is ignored by a real trip: made-up fixes only count in a test drive', () => {
    nav.start(demoRoute());
    nav.handleFix({ timestamp: 1, coords: { longitude: 153.03, latitude: -27.47, accuracy: 5, speed: 10, heading: 90 } } as never, 'simulation');
    expect(nav.getSnapshot().position).toBeNull();
  });

  it('stops feeding fixes when the trip is ended', () => {
    startTestDrive(nav, demoRoute(), null);
    jest.advanceTimersByTime(3000);
    nav.stop();
    const spy = jest.spyOn(nav, 'handleFix');
    jest.advanceTimersByTime(5000);
    expect(spy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a second test drive replaces the first', () => {
    startTestDrive(nav, demoRoute(), 'one');
    jest.advanceTimersByTime(2000);
    startTestDrive(nav, demoRoute(), 'two');
    expect(nav.getSnapshot().destinationName).toBe('two');
    expect(jest.getTimerCount()).toBe(1);
  });

  it('a real trip afterwards records as usual', async () => {
    startTestDrive(nav, demoRoute(), null);
    nav.stop();
    nav.start(demoRoute());
    expect(isNavigationRecording()).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPermission).toHaveBeenCalled();
  });

  it('does nothing when navigation can’t follow the route', () => {
    const r = { ...demoRoute(), geometry: [DEMO_ORIGIN] };
    const stop = startTestDrive(nav, r, null);
    expect(nav.getSnapshot().active).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  it('can be stopped from the returned function', () => {
    const stop = startTestDrive(nav, demoRoute(), null);
    stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
