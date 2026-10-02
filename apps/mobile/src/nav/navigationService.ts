import { type NavEvent, NavigationSession, type NavState } from '@wayfinder/nav';
import { type LngLat, bearingDeg, haversineM } from '@wayfinder/shared/geo';
import { type Route, RouteSchema } from '@wayfinder/shared/schemas';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { speak as say, stopSpeaking } from './voice';
import { api } from '../lib/api';
import { askForNotifications } from '../lib/notifications';
import { setNavigationRecording } from '../tracking/navigationRecording';
import { sqliteQueueStore } from '../tracking/sqliteStore';
import { syncQueue } from '../tracking/sync';
import { setNavigationFixHandler, startNavigationLocation, stopNavigationLocation } from './navigationLocation';

/** How long to wait before asking again for a new route after one couldn't be fetched. */
export const REROUTE_RETRY_MS = 15_000;
/**
 * How long a request for a new route may run before it's given up on. Checked as fixes arrive,
 * not with a timer: with the phone locked React Native pauses its timers, and a request that
 * stalls then would otherwise leave "Finding a new route…" up for the rest of the trip.
 */
export const REROUTE_TIMEOUT_MS = 20_000;
/** Below this the phone's compass heading is noise; the direction comes from movement instead. */
const MOVING_MPS = 2;
/** How far to have moved before the direction of travel is worked out from position alone. */
const HEADING_FROM_MOVEMENT_M = 20;

export interface NavSnapshot {
  /** A trip is being followed (the phone's Navigate screen, the car, or both). */
  active: boolean;
  route: Route | null;
  /** What the car shows as the destination; the phone doesn't need it. */
  destinationName: string | null;
  state: NavState | null;
  rerouting: boolean;
  error: string | null;
  muted: boolean;
  position: LngLat | null;
  headingDeg: number | null;
}

export interface StartOptions {
  destinationName?: string;
  simulated?: boolean;
  askForNotifications?: boolean;
}

export interface NavigationService {
  /**
   * `simulated` is a test drive (the car's "auto drive"): it follows fixes fed to [handleFix] by
   * the caller, never uses the phone's location, and records and uploads nothing, so it can't
   * become a trip in the user's coverage. `askForNotifications` is for a trip started on the phone:
   * the "Navigating to …" notification needs permission on Android 13 and up. Never from the car.
   */
  start(route: Route, opts?: StartOptions): void;
  stop(): void;
  setMuted(muted: boolean): void;
  /** `source` 'simulation' is the test drive's own fixes: the only ones a test drive follows. */
  handleFix(loc: Location.LocationObject, source?: 'watch' | 'service' | 'simulation'): void;
  getSnapshot(): NavSnapshot;
  subscribe(listener: () => void): () => void;
}

const REROUTE_FAILED = 'Couldn’t get a new route. Keep heading to the destination; trying again shortly.';

const IDLE: NavSnapshot = { active: false, route: null, destinationName: null, state: null, rerouting: false, error: null, muted: false, position: null, headingDeg: null };

/**
 * Starts and stops of the location service, run one at a time in order: every trip uses the same
 * task, so an earlier trip's start or stop finishing late would otherwise undo a newer trip's.
 * It begins by stopping one left running: Android restarts a registered location task when the app
 * next starts (after it was swiped away mid-trip, say), and no trip can exist before this loads.
 */
let locationOps: Promise<unknown> = Promise.resolve();
let locationOpsWaiting = 0;
function inTurn(run: () => Promise<unknown>): Promise<unknown> {
  // With nothing in flight it runs at once, so a stop takes effect straight away.
  const op = locationOpsWaiting === 0 ? new Promise((resolve) => resolve(run())) : locationOps.then(run);
  locationOpsWaiting++;
  locationOps = op.catch(() => undefined).finally(() => locationOpsWaiting--);
  return op;
}
void inTurn(stopNavigationLocation).catch(() => undefined);

/** Run a phone service call whose failure shouldn't stop navigation (it may throw or reject). */
function quietly(run: () => unknown) {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch {
    // ignored: see above
  }
}

/**
 * The one navigation session: snaps GPS to the route, speaks manoeuvres, reroutes after repeated
 * off-route fixes, and records the trip (source "navigation"). The phone's Navigate screen and the
 * car screen both follow it, so a trip started on either shows on both.
 */
export function createNavigationService(): NavigationService {
  let snap = IDLE;
  const listeners = new Set<() => void>();
  let session: NavigationSession | null = null;
  let sessionId = '';
  let watch: Location.LocationSubscription | null = null;
  let uploader: ReturnType<typeof setInterval> | null = null;
  let reroutingNow = false;
  /** When the request for a new route in flight was made, and its number: one given up on is ignored. */
  let reroutingSince = 0;
  let rerouteAttempt = 0;
  /** Set while off route without a new route yet, so a failed attempt is retried. */
  let pendingReroute: { to: LngLat; via: LngLat[]; at: number } | null = null;
  /** Bumped by every start and stop, so work from an earlier trip that finishes late is dropped. */
  let generation = 0;
  let lastFixTs = -Infinity;
  let lastServiceFixTs = -Infinity;
  /** Which way the car is going, so a new route starts that way rather than turning it round. */
  let travelHeading: number | null = null;
  let movedFrom: LngLat | null = null;
  /** The trip being followed is a test drive: nothing about it is saved. */
  let simulated = false;

  const set = (patch: Partial<NavSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l());
  };

  const speak = (text: string) => {
    if (snap.muted) return;
    quietly(() => stopSpeaking());
    quietly(() => say(text));
  };

  async function reroute(from: LngLat, to: LngLat, via: LngLat[]) {
    const current = session;
    if (!current || reroutingNow) return;
    const attempt = ++rerouteAttempt;
    reroutingNow = true;
    reroutingSince = Date.now();
    pendingReroute = { to, via, at: reroutingSince };
    set({ rerouting: true });
    // Navigation ended, or this attempt was given up on, while waiting.
    const stale = () => session !== current || attempt !== rerouteAttempt;
    try {
      // On foot, turning round is no trouble; in a car it can mean a long way back.
      const heading = current.mode === 'car' && travelHeading !== null ? { heading: travelHeading } : {};
      const next = await api.request('api/routes/fastest', { method: 'POST', body: { from, to, via, mode: current.mode, ...heading }, schema: RouteSchema });
      if (stale()) return;
      current.replaceRoute(next);
      pendingReroute = null;
      set({ route: next, error: null });
      speak('Route updated');
    } catch {
      if (!stale()) set({ error: REROUTE_FAILED });
    } finally {
      if (!stale()) {
        reroutingNow = false;
        set({ rerouting: false });
      }
    }
  }

  /** Stop waiting for a new route that hasn't come; ask again a little later if still off route. */
  function abandonReroute() {
    rerouteAttempt++;
    reroutingNow = false;
    if (pendingReroute) {
      pendingReroute = { ...pendingReroute, at: Date.now() };
      set({ rerouting: false, error: REROUTE_FAILED });
    } else set({ rerouting: false });
  }

  function handleEvents(events: NavEvent[]) {
    for (const e of events) {
      if (e.type === 'announce') speak(e.text);
      if (e.type === 'arrived') {
        speak('You have arrived');
        if (!simulated) void syncQueue().catch(() => undefined);
      }
      if (e.type === 'backOnRoute') {
        pendingReroute = null;
        set({ error: null });
      }
      if (e.type === 'offRoute') void reroute(e.from, e.to, e.remainingVia);
    }
  }

  function handleFix(loc: Location.LocationObject, source: 'watch' | 'service' | 'simulation' = 'watch') {
    const nav = session;
    if (!nav) return;
    // A test drive ignores the phone's real position, and a real trip ignores made-up fixes.
    if (simulated !== (source === 'simulation')) return;
    const { longitude: lon, latitude: lat } = loc.coords;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    // The location service and the GPS watch deliver the same fixes; follow each once. Only the
    // service's are compared with every fix so far: the watch alone may repeat a timestamp.
    if (loc.timestamp <= (source === 'service' ? lastFixTs : lastServiceFixTs)) return;
    lastFixTs = Math.max(lastFixTs, loc.timestamp);
    if (source === 'service') lastServiceFixTs = loc.timestamp;
    const fix = { ts: loc.timestamp, lon, lat, accuracyM: loc.coords.accuracy, speedMps: loc.coords.speed, headingDeg: loc.coords.heading };
    followHeading(fix);
    let result: ReturnType<NavigationSession['update']>;
    try {
      result = nav.update(fix);
    } catch {
      set({ position: [lon, lat] });
      return; // one odd fix; the next one carries on
    }
    set({ position: [lon, lat], headingDeg: fix.headingDeg ?? snap.headingDeg, state: result.state });
    handleEvents(result.events);
    if (reroutingNow && Date.now() - reroutingSince >= REROUTE_TIMEOUT_MS) abandonReroute();
    // Still off route after a failed attempt: ask again from here, now and then.
    const pending = pendingReroute;
    if (result.state.status === 'offRoute' && pending && !reroutingNow && Date.now() - pending.at >= REROUTE_RETRY_MS) {
      void reroute([lon, lat], pending.to, pending.via);
    }
    if (simulated) return;
    void sqliteQueueStore
      .append([
        {
          ...fix,
          accuracyM: fix.accuracyM ?? null,
          speedMps: fix.speedMps ?? null,
          headingDeg: fix.headingDeg ?? null,
          source: 'navigation',
          mode: nav.mode,
          sessionId,
        },
      ])
      .catch(() => undefined);
  }

  function followHeading(fix: { lon: number; lat: number; speedMps?: number | null; headingDeg?: number | null }) {
    const here: LngLat = [fix.lon, fix.lat];
    const h = fix.headingDeg;
    if ((fix.speedMps ?? 0) >= MOVING_MPS && h != null && Number.isFinite(h) && h >= 0) {
      travelHeading = h % 360;
      movedFrom = here;
    } else if (!movedFrom) {
      movedFrom = here;
    } else if (haversineM(movedFrom, here) >= HEADING_FROM_MOVEMENT_M) {
      travelHeading = bearingDeg(movedFrom, here);
      movedFrom = here;
    }
  }

  function stop() {
    const wasActive = session !== null;
    const wasSimulated = simulated;
    simulated = false;
    generation++;
    watch?.remove();
    watch = null;
    if (wasActive && !wasSimulated) void inTurn(stopNavigationLocation).catch(() => undefined);
    if (uploader) clearInterval(uploader);
    uploader = null;
    session = null;
    pendingReroute = null;
    reroutingNow = false;
    rerouteAttempt++; // an answer for the trip that ended is ignored
    setNavigationRecording(false);
    quietly(() => stopSpeaking());
    if (wasActive && !wasSimulated) void syncQueue().catch(() => undefined);
    if (snap !== IDLE) set(IDLE);
  }

  function start(route: Route, opts: StartOptions = {}) {
    stop();
    let next: NavigationSession;
    try {
      next = new NavigationSession(route);
    } catch {
      // A route too short to follow (from and to the same place, say) must not take the app down.
      set({ ...IDLE, route, error: 'This route can’t be followed. Plan it again, then start the new one.' });
      return;
    }
    session = next;
    simulated = opts.simulated === true;
    sessionId = Crypto.randomUUID();
    lastFixTs = -Infinity;
    lastServiceFixTs = -Infinity;
    travelHeading = null;
    movedFrom = null;
    const gen = generation;
    set({ ...IDLE, active: true, route, destinationName: opts.destinationName ?? null });
    // A test drive is fed its fixes by the caller and saves nothing.
    if (simulated) return;
    // This trip records its own fixes; background recording leaves it to it until it ends.
    setNavigationRecording(true);
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (gen !== generation) return;
        if (!perm.granted) {
          set({ error: 'Navigation needs location permission.' });
          return;
        }
        if (opts.askForNotifications) {
          await askForNotifications();
          if (gen !== generation) return;
        }
        // Failing to start it only matters with the phone locked; the watch below still navigates.
        void inTurn(async () => {
          if (gen !== generation) return; // this trip ended before its turn came
          await startNavigationLocation(opts.destinationName ?? null);
          // No trip left by the time it started: the foreground service mustn't outlive it. (A
          // newer trip's service is left alone; its own stop comes after this in turn.)
          if (session === null) await stopNavigationLocation();
        }).catch(() => undefined);
        const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 1000 }, (loc) => handleFix(loc));
        // Ended while the phone was asking or starting GPS: stop it straight away.
        if (gen !== generation) sub.remove();
        else watch = sub;
      } catch {
        if (gen === generation) set({ error: 'Can’t get your location. Check that location is switched on, then start again.' });
      }
    })();
    uploader = setInterval(() => void syncQueue().catch(() => undefined), 60_000);
  }

  return {
    start,
    stop,
    handleFix,
    setMuted: (muted) => set({ muted }),
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const navigation = createNavigationService();
setNavigationFixHandler((locs) => locs.forEach((l) => navigation.handleFix(l, 'service')));
