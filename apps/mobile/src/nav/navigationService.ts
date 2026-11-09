import { type NavEvent, NavigationSession, type NavState } from '@wayfinder/nav';
import { type LngLat, bearingDeg, haversineM, lineLengthM } from '@wayfinder/shared/geo';
import { type Route, RouteSchema } from '@wayfinder/shared/schemas';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { speak as say, stopSpeaking } from './voice';
import { AppState } from 'react-native';
import { api } from '../lib/api';
import { timerHold } from '../lib/keepTimers';
import { askForNotifications } from '../lib/notifications';
import { setNavigationRecording } from '../tracking/navigationRecording';
import { cachedAccountId } from '../lib/account';
import { sqliteQueueStore } from '../tracking/sqliteStore';
import { syncQueue } from '../tracking/sync';
import { setNavigationFixHandler, startNavigationLocation, stopNavigationLocation } from './navigationLocation';

/** How long to wait before asking again for a new route after one couldn't be fetched. */
export const REROUTE_RETRY_MS = 15_000;
/** Each failure in a row doubles the wait, up to this, so a long outage isn't asked every 15 s. */
export const REROUTE_RETRY_MAX_MS = 120_000;
/** A fix less sure of where it is than this isn't recorded as driven (it still moves the arrow). */
export const RECORD_MAX_ACCURACY_M = 50;
/**
 * Faster than this from the last recorded fix is a jump, not driving: a bad fix, or a phone that
 * lost and found itself. It isn't recorded, and the trail on the map starts again from it.
 */
export const JUMP_SPEED_MPS = 70;
/**
 * After leaving an explore route, a detour point is kept only while going by it adds no more than
 * this share of the straight way to the destination (plus [VIA_KEEP_SLACK_M]): a missed turn
 * shouldn't drag the driver back across town to every point left.
 */
export const VIA_KEEP_RATIO = 1.25;
export const VIA_KEEP_SLACK_M = 2000;
/**
 * How long a request for a new route may run before it's given up on. Checked as fixes arrive,
 * not with a timer: with the phone locked React Native pauses its timers, and a request that
 * stalls then would otherwise leave "Finding a new route…" up for the rest of the trip.
 */
export const REROUTE_TIMEOUT_MS = 20_000;
/** How long "You've arrived" stays up before the trip ends by itself. */
export const ARRIVED_END_MS = 15_000;
/**
 * After a new route that starts by turning around (a dead-end street, say), how long to let the
 * driver find somewhere to do it before asking again. Asking sooner gets the same answer: the
 * driver heard "Route updated" every few seconds while looking for a place to turn.
 */
export const TURNAROUND_GRACE_MS = 60_000;
/**
 * Driven this far from where that route was given, the driver isn't looking for a place to turn any
 * more (they've carried on, or taken another road), so the wait is over: the old route is no use.
 */
export const TURNAROUND_MOVED_M = 150;
/** How long to wait for the first fix before saying the phone can't find where it is. */
export const FIRST_FIX_WAIT_MS = 30_000;
/** The car's location is followed once the phone's has been silent this long. */
export const CAR_FIX_AFTER_MS = 5_000;
export type FixSource = 'watch' | 'service' | 'simulation' | 'car';
/** How far apart points of the road already driven are kept, in metres. */
const TRAVELLED_STEP_M = 10;
/** The most points of the road driven kept; past it every other point goes and the step doubles. */
export const TRAVELLED_MAX_POINTS = 1500;
/** Once this far along a turn-around route the driver has turned, and normal rerouting resumes. */
const TURNAROUND_DONE_M = 50;
const NO_FIX_YET = 'Still finding where you are. When it’s safe, check that location is on for Wayfinder on your phone.';
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
  /** Speed from the last fix, metres a second, or null where the phone didn't say. */
  speedMps: number | null;
  /** Where this trip has been, including any stretch off the route. */
  travelled: LngLat[];
  /** A test drive (the car's auto drive): nothing about it is recorded. */
  simulated: boolean;
  /** The trip that last ended, for a summary and a way to pick it up again (P23, P63, P97). Null during a trip. */
  ended: EndedTrip | null;
}

/** A trip that has ended: what it was, how it ended, and how far it went. */
export interface EndedTrip {
  route: Route;
  destinationName: string | null;
  /** It ended by arriving (by itself, or Done), not with End. */
  arrived: boolean;
  /** How far the phone saw you go, metres. Under [NOTHING_RECORDED_M] nothing was recorded worth keeping. */
  distanceM: number;
  durationS: number;
  /** When it ended, by this clock. */
  at: number;
}

/** A trip that moved less than this left nothing on Trips: the summary says so (P97). */
export const NOTHING_RECORDED_M = 100;

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
  /** Forgets the trip that last ended, once its summary has been seen. */
  dismissEnded(): void;
  setMuted(muted: boolean): void;
  /**
   * Leave an explore route's detour: the fastest way from here to the destination, dropping the
   * detour points still ahead. Nothing happens on any other trip, or before the first fix.
   */
  skipDetour(): void;
  /**
   * `source` 'simulation' is the test drive's own fixes: the only ones a test drive follows. 'car' is
   * the car's own location, followed only while the phone's has been silent for [CAR_FIX_AFTER_MS].
   */
  handleFix(loc: Location.LocationObject, source?: FixSource): void;
  getSnapshot(): NavSnapshot;
  subscribe(listener: () => void): () => void;
}

const TIMERS_FOR_TRIP = 'trip';
const REROUTE_FAILED = 'Couldn’t get a new route. Keep heading to the destination; trying again shortly.';
/** Where the voice being muted is kept, so it stays as it was left trip to trip and across restarts. */
const MUTED_KEY = 'wf.voiceMuted';

const IDLE: NavSnapshot = {
  active: false,
  route: null,
  destinationName: null,
  state: null,
  rerouting: false,
  error: null,
  muted: false,
  position: null,
  headingDeg: null,
  speedMps: null,
  travelled: [],
  ended: null,
  simulated: false,
};

/**
 * The detour points still worth going by from [from] on the way to [to]: in order, each kept only
 * while the way by the ones kept so far stays within [VIA_KEEP_RATIO] of the straight way.
 */
export function viaStillWorthIt(from: LngLat, to: LngLat, via: LngLat[]): LngLat[] {
  const allowed = haversineM(from, to) * VIA_KEEP_RATIO + VIA_KEEP_SLACK_M;
  const kept: LngLat[] = [];
  for (const v of via) {
    const path = [from, ...kept, v, to];
    let length = 0;
    for (let i = 1; i < path.length; i++) length += haversineM(path[i - 1]!, path[i]!);
    if (length <= allowed) kept.push(v);
  }
  return kept;
}

/** Speed between two fixes however far apart in time, or null if they're at the same moment. */
function speedBetweenAny(a: { ts: number; lon: number; lat: number }, b: { ts: number; lon: number; lat: number }): number | null {
  const dt = (b.ts - a.ts) / 1000;
  return dt > 0 ? haversineM([a.lon, a.lat], [b.lon, b.lat]) / dt : Infinity;
}

/** Speed between two fixes, metres a second, or null when they're too far apart in time to say. */
function speedBetween(a: { ts: number; lon: number; lat: number }, b: { ts: number; lon: number; lat: number }): number | null {
  const dt = (b.ts - a.ts) / 1000;
  if (!(dt > 0) || dt > 10) return null;
  return haversineM([a.lon, a.lat], [b.lon, b.lat]) / dt;
}

/** GraphHopper's U-turn signs: -98 direction unknown, -8 left, 8 right. */
const isTurnaround = (sign: number | undefined) => sign === -98 || sign === -8 || sign === 8;

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
  /** Asks the engine every second between fixes (see NavigationSession.tick). */
  let ticker: ReturnType<typeof setInterval> | null = null;
  let reroutingNow = false;
  /** When the request for a new route in flight was made, and its number: one given up on is ignored. */
  let reroutingSince = 0;
  let rerouteAttempt = 0;
  /** New routes asked for in a row that couldn't be had: each doubles the wait before the next. */
  let rerouteFailures = 0;
  /** The last fix recorded for this trip, to tell a jump from driving. */
  let lastRecorded: { ts: number; lon: number; lat: number } | null = null;
  /** The fix before this one, to work out a speed the phone didn't give. */
  let previousFix: { ts: number; lon: number; lat: number } | null = null;
  /** Set while off route without a new route yet, so a failed attempt is retried. */
  let pendingReroute: { to: LngLat; via: LngLat[]; at: number; kind?: Route['kind'] } | null = null;
  /** Bumped by every start and stop, so work from an earlier trip that finishes late is dropped. */
  let generation = 0;
  let lastFixTs = -Infinity;
  /** When the trip being followed started, by this clock. */
  let startedAt = 0;
  let lastServiceFixTs = -Infinity;
  /** Which way the car is going, so a new route starts that way rather than turning it round. */
  let travelHeading: number | null = null;
  let movedFrom: LngLat | null = null;
  /** The trip being followed is a test drive: nothing about it is saved. */
  let simulated = false;
  /** When the phone last gave a fix, by this clock. */
  let lastPhoneFixAt = -Infinity;
  /** When the destination was reached; the trip ends by itself [ARRIVED_END_MS] later. */
  let arrivedAt: number | null = null;
  /** When a new route that starts by turning around was given (see [TURNAROUND_GRACE_MS]). */
  let turnaroundSince: number | null = null;
  /** Where that route was given; cleared when asking again, so a failed attempt waits to retry. */
  let turnaroundFrom: LngLat | null = null;
  /** The location service is up. It's refused with no app screen showing, so it's tried again when one shows. */
  let locationService = false;
  let appState: { remove(): void } | null = null;
  let travelledStepM = TRAVELLED_STEP_M;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const set = (patch: Partial<NavSnapshot>) => {
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l());
  };
  /** No trip, with the voice as it was left. */
  const idle = (): NavSnapshot => ({ ...IDLE, muted: snap.muted });
  let mutedChosen = false;
  void (async () => {
    try {
      // Muted before this was read (in the car, say): that choice stands.
      if ((await SecureStore.getItemAsync(MUTED_KEY)) === 'on' && !mutedChosen) set({ muted: true });
    } catch {
      // Unreadable storage: the voice starts on.
    }
  })();
  const setMuted = (muted: boolean) => {
    mutedChosen = true;
    set({ muted });
    quietly(() => SecureStore.setItemAsync(MUTED_KEY, muted ? 'on' : 'off'));
  };

  const speak = (text: string) => {
    if (snap.muted) return;
    quietly(() => stopSpeaking());
    quietly(() => say(text));
  };

  /**
   * A new route from here. It stays the kind of trip it was (an explore route stays one, its
   * remaining detour points kept), unless `kind` says otherwise, as skipping the detour does.
   */
  async function reroute(from: LngLat, to: LngLat, via: LngLat[], kind?: Route['kind']) {
    const current = session;
    if (!current || reroutingNow) return;
    const attempt = ++rerouteAttempt;
    turnaroundFrom = null;
    reroutingNow = true;
    reroutingSince = Date.now();
    pendingReroute = { to, via, at: reroutingSince, ...(kind ? { kind } : {}) };
    set({ rerouting: true });
    // Navigation ended, or this attempt was given up on, while waiting.
    const stale = () => session !== current || attempt !== rerouteAttempt;
    try {
      // On foot, turning round is no trouble; in a car it can mean a long way back.
      const heading = current.mode === 'car' && travelHeading !== null ? { heading: travelHeading, ...(snap.speedMps !== null ? { speedMps: snap.speedMps } : {}) } : {};
      const fresh = await api.request('api/routes/fastest', { method: 'POST', body: { from, to, via, mode: current.mode, ...heading }, schema: RouteSchema });
      if (stale()) return;
      rerouteFailures = 0;
      // With no detour points left it is just the fastest way now.
      const next: Route = { ...fresh, kind: kind ?? (via.length === 0 && current.currentRoute.kind === 'explore' ? 'fastest' : current.currentRoute.kind) };
      current.replaceRoute(next);
      pendingReroute = null;
      set({ route: next, error: null });
      const first = next.instructions[0];
      // Only a route asked for with the car's heading says "turn around when you can"; without one a
      // U-turn is just the best way from here, and the driver may do it at once.
      const turnaround = 'heading' in heading && isTurnaround(first?.sign);
      // Driven on up the street and told the same again within the minute: once is enough.
      const alreadyTold = turnaround && turnaroundSince !== null && Date.now() - turnaroundSince < TURNAROUND_GRACE_MS;
      if (!alreadyTold) turnaroundSince = turnaround ? Date.now() : null;
      turnaroundFrom = turnaround ? from : null;
      // Say what to do next, not just that something changed.
      if (!alreadyTold) speak(first?.text ? `Route updated. ${first.text}` : 'Route updated');
    } catch {
      if (!stale()) {
        rerouteFailures++;
        set({ error: REROUTE_FAILED });
      }
    } finally {
      if (!stale()) {
        reroutingNow = false;
        set({ rerouting: false });
      }
    }
  }

  function skipDetour() {
    const nav = session;
    const here = snap.position;
    if (!nav || !here || nav.currentRoute.kind !== 'explore' || snap.rerouting) return;
    void reroute(here, nav.currentRoute.geometry.at(-1)!, [], 'fastest');
  }

  /** Stop waiting for a new route that hasn't come; ask again a little later if still off route. */
  function abandonReroute() {
    rerouteAttempt++;
    rerouteFailures++;
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
        arrivedAt = Date.now();
        later(ARRIVED_END_MS, () => endIfArrived());
      }
      if (e.type === 'backOnRoute') {
        pendingReroute = null;
        turnaroundSince = null;
        turnaroundFrom = null;
        set({ error: null });
      }
      if (e.type === 'offRoute') {
        // Told to turn around and not yet able to: asking again now would only say the same.
        if (turnaroundSince !== null && Date.now() - turnaroundSince < TURNAROUND_GRACE_MS) {
          pendingReroute = { to: e.to, via: viaStillWorthIt(e.from, e.to, e.remainingVia), at: turnaroundSince + TURNAROUND_GRACE_MS - REROUTE_RETRY_MS };
        } else void reroute(e.from, e.to, viaStillWorthIt(e.from, e.to, e.remainingVia));
      }
    }
  }

  /** Runs [run] after [ms] if the same trip is still going. */
  function later(ms: number, run: () => void) {
    const gen = generation;
    timers.push(setTimeout(() => gen === generation && run(), ms));
  }

  /**
   * Ends the trip once it has been arrived at for [ARRIVED_END_MS]. Also checked on each fix,
   * as timers don't run with the phone locked.
   */
  function endIfArrived() {
    if (arrivedAt !== null && Date.now() - arrivedAt >= ARRIVED_END_MS) stop();
  }

  function handleFix(loc: Location.LocationObject, source: FixSource = 'watch') {
    const nav = session;
    if (!nav) return;
    endIfArrived();
    if (session !== nav) return;
    // A test drive ignores the phone's real position, and a real trip ignores made-up fixes.
    if (simulated !== (source === 'simulation')) return;
    const { longitude: lon, latitude: lat } = loc.coords;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    // The car's location is for when the phone can't say where it is (locked and in a pocket, or
    // GPS not started from the background); the phone's own fixes win while they come.
    if (source === 'car') {
      if (Date.now() - lastPhoneFixAt < CAR_FIX_AFTER_MS) return;
    } else if (source !== 'simulation') lastPhoneFixAt = Date.now();
    // The location service and the GPS watch deliver the same fixes; follow each once. Only the
    // service's are compared with every fix so far: the watch alone may repeat a timestamp.
    if (loc.timestamp <= (source === 'service' || source === 'car' ? lastFixTs : lastServiceFixTs)) return;
    lastFixTs = Math.max(lastFixTs, loc.timestamp);
    if (source === 'service') lastServiceFixTs = loc.timestamp;
    const given = loc.coords.speed != null && Number.isFinite(loc.coords.speed) && loc.coords.speed >= 0 ? loc.coords.speed : null;
    // No speed from the phone (some fixes carry none): work it out from the last fix.
    const at = { ts: loc.timestamp, lon, lat };
    const worked = given ?? (previousFix ? speedBetween(previousFix, at) : null);
    previousFix = at;
    const fix = { ts: loc.timestamp, lon, lat, accuracyM: loc.coords.accuracy, speedMps: given, headingDeg: loc.coords.heading };
    followHeading({ ...fix, speedMps: worked });
    const here: LngLat = [lon, lat];
    const speedMps = worked;
    // A jump (a bad fix, or the phone finding itself far from where it thought) isn't driving.
    const jumped = lastRecorded !== null && haversineM([lastRecorded.lon, lastRecorded.lat], here) > 200 && (speedBetweenAny(lastRecorded, at) ?? 0) > JUMP_SPEED_MPS;
    const firstFix = snap.error === NO_FIX_YET ? { error: null } : {};
    let result: ReturnType<NavigationSession['update']>;
    try {
      result = nav.update(fix);
    } catch {
      set({ position: here, speedMps, ...firstFix });
      return; // one odd fix; the next one carries on
    }
    // The way the car is going, not the fix's own heading: stopped, Android reports 0 (no
    // bearing), which would turn the car's arrow and map to face north at every red light.
    set({ position: here, headingDeg: travelHeading ?? snap.headingDeg, speedMps, travelled: jumped ? [here] : withTravelled(snap.travelled, here), state: result.state, ...firstFix });
    if (turnaroundSince !== null && result.state.status === 'navigating' && result.state.progressM >= TURNAROUND_DONE_M) {
      turnaroundSince = null;
      turnaroundFrom = null;
    }
    handleEvents(result.events);
    if (reroutingNow && Date.now() - reroutingSince >= REROUTE_TIMEOUT_MS) abandonReroute();
    // Still off route after a failed attempt: ask again from here, now and then.
    const pending = pendingReroute;
    const drivenOn = turnaroundFrom !== null && haversineM(turnaroundFrom, here) >= TURNAROUND_MOVED_M;
    const retryAfter = Math.min(REROUTE_RETRY_MAX_MS, REROUTE_RETRY_MS * 2 ** Math.max(0, rerouteFailures - 1));
    if (result.state.status === 'offRoute' && pending && !reroutingNow && (drivenOn || Date.now() - pending.at >= retryAfter)) {
      void reroute([lon, lat], pending.to, pending.via, pending.kind);
    }
    if (simulated) return;
    // Only fixes that are sure of where they are, and follow on from the last, count as driven: the
    // server credits roads between recorded points.
    if (jumped) {
      lastRecorded = at;
      return;
    }
    if (fix.accuracyM != null && fix.accuracyM > RECORD_MAX_ACCURACY_M) return;
    lastRecorded = at;
    const account = cachedAccountId();
    if (!account) return;
    void sqliteQueueStore
      .append(
        [
          {
            ...fix,
            accuracyM: fix.accuracyM ?? null,
            speedMps: fix.speedMps ?? null,
            headingDeg: fix.headingDeg ?? null,
            source: 'navigation',
            mode: nav.mode,
            sessionId,
          },
        ],
        account,
      )
      .catch(() => undefined);
  }

  /**
   * The road driven so far, a point every [TRAVELLED_STEP_M] or so (the same array when it hasn't
   * grown). Capped at [TRAVELLED_MAX_POINTS]: on a long drive the older road is drawn more coarsely
   * rather than the trail growing, and being copied on every fix, without limit.
   */
  function withTravelled(line: LngLat[], here: LngLat): LngLat[] {
    const last = line[line.length - 1];
    if (last && haversineM(last, here) < travelledStepM) return line;
    const next = [...line, here];
    if (next.length <= TRAVELLED_MAX_POINTS) return next;
    travelledStepM *= 2;
    return next.filter((_, i) => i % 2 === 0 || i === next.length - 1);
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
    const ended: EndedTrip | null =
      wasActive && !wasSimulated && snap.route
        ? {
            route: snap.route,
            destinationName: snap.destinationName,
            arrived: arrivedAt !== null || snap.state?.status === 'arrived',
            distanceM: snap.travelled.length > 1 ? lineLengthM(snap.travelled) : 0,
            durationS: Math.max(0, (Date.now() - startedAt) / 1000),
            at: Date.now(),
          }
        : snap.ended;
    simulated = false;
    generation++;
    timerHold.release(TIMERS_FOR_TRIP);
    appState?.remove();
    appState = null;
    locationService = false;
    watch?.remove();
    watch = null;
    if (wasActive && !wasSimulated) void inTurn(stopNavigationLocation).catch(() => undefined);
    if (uploader) clearInterval(uploader);
    uploader = null;
    if (ticker) clearInterval(ticker);
    ticker = null;
    session = null;
    pendingReroute = null;
    reroutingNow = false;
    arrivedAt = null;
    turnaroundSince = null;
    turnaroundFrom = null;
    timers.forEach(clearTimeout);
    timers = [];
    rerouteAttempt++; // an answer for the trip that ended is ignored
    setNavigationRecording(false);
    quietly(() => stopSpeaking());
    if (wasActive && !wasSimulated) void syncQueue().catch(() => undefined);
    const rest = { ...idle(), ended };
    if ((Object.keys(rest) as Array<keyof NavSnapshot>).some((k) => snap[k] !== rest[k])) set(rest);
  }

  /** The summary of the trip that ended has been read: it goes. */
  function dismissEnded() {
    if (snap.ended) set({ ended: null });
  }

  function start(route: Route, opts: StartOptions = {}) {
    stop();
    let next: NavigationSession;
    try {
      next = new NavigationSession(route);
    } catch {
      // A route too short to follow (from and to the same place, say) must not take the app down.
      set({ ...idle(), route, error: 'This route can’t be followed. Plan it again, then start the new one.' });
      return;
    }
    session = next;
    simulated = opts.simulated === true;
    sessionId = Crypto.randomUUID();
    startedAt = Date.now();
    lastFixTs = -Infinity;
    lastServiceFixTs = -Infinity;
    lastPhoneFixAt = -Infinity;
    lastRecorded = null;
    previousFix = null;
    rerouteFailures = 0;
    travelHeading = null;
    movedFrom = null;
    travelledStepM = TRAVELLED_STEP_M;
    const gen = generation;
    set({ ...idle(), active: true, route, destinationName: opts.destinationName ?? null, simulated });
    timerHold.hold(TIMERS_FOR_TRIP);
    // A test drive is fed its fixes by the caller and saves nothing.
    if (simulated) return;
    // Standing still, the phone sends no fixes (one a second or every 5 m): a wait at the lights still
    // counts on. (A test drive is fed a fix every second, so needs none.)
    ticker = setInterval(() => {
      const nav = session;
      if (!nav || !snap.state) return;
      const state = nav.tick(Date.now());
      if (state !== snap.state) set({ state });
    }, 1000);
    // No fix yet after a while: say so, rather than leave the car on "Starting…" with no reason.
    later(FIRST_FIX_WAIT_MS, () => {
      if (snap.position === null && snap.error === null) set({ error: NO_FIX_YET });
    });
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
        const startService = () =>
          void inTurn(async () => {
            if (gen !== generation) return; // this trip ended before its turn came
            await startNavigationLocation(opts.destinationName ?? null);
            if (gen === generation) locationService = true;
            // No trip left by the time it started: the foreground service mustn't outlive it. (A
            // newer trip's service is left alone; its own stop comes after this in turn.)
            if (session === null) await stopNavigationLocation();
          }).catch(() => undefined);
        startService();
        appState = AppState.addEventListener('change', (state) => {
          if (state === 'active' && !locationService && gen === generation) startService();
        });
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
    dismissEnded,
    handleFix,
    setMuted,
    skipDetour,
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
