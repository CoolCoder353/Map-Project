/**
 * The car's test drive ("auto drive", which Google's reviewers and the Desktop Head Unit switch
 * on): a short simulated trip that feeds made-up fixes to the same navigation session a real trip
 * uses, so the car shows real directions without anyone driving.
 *
 * Which route it follows: the trip already running, else a real route on the roads to somewhere
 * about two kilometres away (see handlers.ts), else, with no server, a built-in demo route that
 * starts where the phone is (or in central Brisbane when the phone can't say).
 * A test drive is marked `simulated` in the navigation service, which records nothing, uploads
 * nothing and starts no location service, so it can never become a trip in someone's coverage.
 */
import { simulateFixes } from '@wayfinder/nav';
import { type LngLat, destination, lineLengthM } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
import type { NavigationService } from '../nav/navigationService';

/** Central Brisbane: where the demo route starts when the phone has no position. [lon, lat] */
export const DEMO_ORIGIN: LngLat = [153.0251, -27.4698];
export const DEMO_DESTINATION_NAME = 'Test drive';
/** Real seconds between simulated fixes. */
const TICK_MS = 1000;
/**
 * How fast a test drive goes: the route's own average, as a car would drive it, never faster than
 * this. It was the route's length over 90 seconds, so a long trip "drove" at 216 km/h past 60 signs,
 * red for speeding the whole way (C86).
 */
export const MAX_TEST_SPEED_MPS = 25;
const MIN_SPEED_MPS = 5;

/** The speed a test drive along [route] goes at. */
export function testDriveSpeed(route: Pick<Route, 'distanceM' | 'durationS'>): number {
  const average = route.durationS > 0 ? route.distanceM / route.durationS : MAX_TEST_SPEED_MPS;
  return Math.min(MAX_TEST_SPEED_MPS, Math.max(MIN_SPEED_MPS, average));
}

/** Where a test drive with no trip heads: this far, east of where you are, on real roads. */
export const TEST_DRIVE_M = 2000;
export const testDriveTarget = (origin: LngLat = DEMO_ORIGIN): LngLat => destination(origin, 90, TEST_DRIVE_M);

/**
 * About two kilometres: east, then a left turn north, then arrive. Straight lines, which cross
 * whatever is there (C84): only when the server can't give a real route.
 */
export function demoRoute(origin: LngLat = DEMO_ORIGIN): Route {
  const corner = destination(origin, 90, 1200);
  const end = destination(corner, 0, 800);
  const geometry: LngLat[] = [origin, corner, end];
  const distanceM = lineLengthM(geometry);
  const speed = 14;
  return {
    id: 'test-drive',
    kind: 'fastest',
    mode: 'car',
    distanceM,
    durationS: distanceM / speed,
    extraDurationS: 0,
    geometry,
    viaPoints: [],
    novelty: { totalKm: distanceM / 1000, newKm: 0, noveltyPct: 0 },
    instructions: [
      { sign: 0, text: 'Continue onto Test Street', streetName: 'Test Street', distanceM: 1200, durationS: 1200 / speed, interval: [0, 1] },
      { sign: -2, text: 'Turn left onto Demo Road', streetName: 'Demo Road', distanceM: 800, durationS: 800 / speed, interval: [1, 2] },
      { sign: 4, text: 'Arrive at destination', streetName: '', distanceM: 0, durationS: 0, interval: [2, 2] },
    ],
  };
}

type Nav = Pick<NavigationService, 'start' | 'stop' | 'handleFix' | 'getSnapshot' | 'subscribe'>;
export interface Timers {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

let stopCurrent: (() => void) | null = null;

/** Ends a test drive's fix feed (not the trip itself). Safe with none running. */
export function cancelTestDrive() {
  stopCurrent?.();
}

/**
 * Starts a test drive along [route] and feeds it a fix every second until it arrives. Starting
 * another replaces it. Returns a function that stops the feed.
 */
export function startTestDrive(
  nav: Nav,
  route: Route,
  destinationName: string | null,
  opts: { now?: () => number; timers?: Timers } = {},
): () => void {
  cancelTestDrive();
  const now = opts.now ?? Date.now;
  const timers: Timers = opts.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) };
  const speedMps = testDriveSpeed(route);
  const fixes = simulateFixes(route.geometry, { speedMps, intervalS: TICK_MS / 1000, startTs: now() });

  nav.start(route, { destinationName: destinationName ?? undefined, simulated: true });
  // A route navigation can't follow leaves it idle with the reason; there is nothing to feed.
  if (!nav.getSnapshot().active) return () => undefined;

  let i = 0;
  let handle: unknown = null;
  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    unsubscribe?.();
    unsubscribe = null;
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  // Someone ended the trip (or started another): stop feeding it.
  unsubscribe = nav.subscribe(() => {
    if (!nav.getSnapshot().active) stop();
  });
  handle = timers.setInterval(() => {
    const f = fixes[i++];
    if (!f) return stop();
    nav.handleFix(
      { timestamp: f.ts, coords: { longitude: f.lon, latitude: f.lat, accuracy: f.accuracyM ?? null, speed: f.speedMps ?? null, heading: f.headingDeg ?? null, altitude: null, altitudeAccuracy: null } },
      'simulation',
    );
    if (i >= fixes.length) stop();
  }, TICK_MS);
  return stop;
}
