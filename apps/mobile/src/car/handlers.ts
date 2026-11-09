import { type CopyCatalog, copyFor } from '@wayfinder/shared/copy';
import { haversineM, type LngLat } from '@wayfinder/shared/geo';
import { exploreTitles, formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { DiscoverResponseSchema, ReverseResponseSchema, ExploreRouteResponseSchema, type FeedbackCreate, type Place, PlannedRouteListSchema, RouteSchema, PublicConfigSchema, type Route, SavedPlaceListSchema, SearchResponseSchema, SpeedLimitResponseSchema } from '@wayfinder/shared/schemas';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { api, hasSavedSession } from '../lib/api';
import { ApiError, isServerUrl } from '../lib/apiClient';
import { kindOf } from '../lib/categories';
import { discoverChoices } from '../lib/discoverChoices';
import { timerHold } from '../lib/keepTimers';
import { getServerUrl } from '../lib/server';
import { navigation, type NavSnapshot } from '../nav/navigationService';
import type { CarHandlers } from './controller';
import { DEMO_DESTINATION_NAME, demoRoute, startTestDrive, testDriveTarget } from './simulation';
import { type CarPlace, CarParams, type CarRouteOption, type CarSpeedLimit, type CarStatus } from './protocol';

let copyCache: CopyCatalog | null = null;

/** The server's chosen voice for words shown in the car; plain until the server says. */
async function copy(): Promise<CopyCatalog> {
  if (copyCache) return copyCache;
  try {
    copyCache = copyFor((await api.request('api/config', { schema: PublicConfigSchema })).voice);
    return copyCache;
  } catch {
    return copyFor('plain');
  }
}

/** The car's own last position, which Android Auto gives us from the car's GNSS. [at] is when it arrived, by this phone's clock. */
let lastCarFix: { at: number; position: LngLat } | null = null;
/** A car position older than this isn't where you are any more. */
const CAR_FIX_MAX_AGE_MS = 60_000;

/**
 * How long Discover and planning wait for the phone to find where it is, when it has no recent
 * position and the car hasn't said either. A locked phone in a pocket may never answer, and the
 * car gives up on the whole request soon after (CarBridge.kt), saying the phone isn't answering.
 */
export const PHONE_FIX_WAIT_MS = 8_000;

const located = (loc: Location.LocationObject | null): LngLat | null => (loc ? [loc.coords.longitude, loc.coords.latitude] : null);

/** [p]'s answer, or null if it fails or takes longer than [ms]. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Where you are: the car's own position from the last minute, else the phone's recent one, else
 * (when [fresh]) a new fix from the phone. The car's GNSS reports every second while it is
 * connected, so it beats a phone fix that may be minutes old (15 km at highway speed in ten). The
 * phone says nothing when it is locked in a pocket or has not been given location. Never prompts:
 * the car can't.
 */
async function here(fresh = false): Promise<LngLat | null> {
  if (lastCarFix && Date.now() - lastCarFix.at <= CAR_FIX_MAX_AGE_MS) return lastCarFix.position;
  const granted = await Location.getForegroundPermissionsAsync().then((p) => p.granted, () => false);
  const phone = granted ? located(await Location.getLastKnownPositionAsync({ maxAge: fresh ? 60_000 : 2 * 60_000 }).catch(() => null)) : null;
  if (phone) return phone;
  return granted && fresh ? located(await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), PHONE_FIX_WAIT_MS)) : null;
}

/**
 * How long the car's requests wait for the server: less than the phone's own 30 s, so the car says
 * there's no connection while the driver still remembers asking (C65, C97). CarBridge.kt waits a
 * little longer than this plus PHONE_FIX_WAIT_MS.
 */
export const CAR_SERVER_TIMEOUT_MS = 15_000;
const carRequest = { timeoutMs: CAR_SERVER_TIMEOUT_MS };

export const NO_OTHER_WAYS = 'No other ways fit your extra time. You can allow more in Settings on your phone.';
/** Android Auto shows about six rows while driving; never send more. */
export const MAX_ROWS = 6;
// Shown in the car: anything that sends the driver to the phone says to wait until it's safe (VI-1).
const NO_LOCATION = 'Can’t tell where you are. When it’s safe, check that location is on for Wayfinder on your phone.';

const TIMERS_FOR_CAR = 'car';
export const REPORT_COOLDOWN_MS = 60_000;
export const REPORT_JUST_SENT = 'Already reported. Wait a minute before reporting again.';
export const REPORT_LIMIT = 'Too many reports this hour. When it’s safe, use Send feedback on your phone later.';
export const REPORT_OFF = 'Reporting is switched off for now.';
let lastReportAt = -Infinity;
/** For tests: forget the last report sent. */
export const resetReportCooldown = () => {
  lastReportAt = -Infinity;
};

/** How many routes the car keeps to start by id: every list it has shown in a long drive's searching. */
export const OFFERED_KEPT = 100;
/** Routes the car has been offered, so "Go" can start one by id. The newest [OFFERED_KEPT] are kept. */
const offered = new Map<string, Route>();
function remember(r: Route) {
  offered.delete(r.id);
  offered.set(r.id, r);
  while (offered.size > OFFERED_KEPT) offered.delete(offered.keys().next().value!);
}
export const ROUTE_EXPIRED = 'That route has expired. Go back and choose the place again.';
/** Discover by car leaves out places closer than this: they're a walk, not a drive. */
export const DISCOVER_MIN_M = 1000;

const toPlace = (p: Place): CarPlace => ({
  id: p.id,
  name: p.name,
  detail: [p.context ?? p.typeLabel ?? p.description, p.distanceM != null ? `${formatDistanceShort(p.distanceM)} away` : null].filter(Boolean).join(' · '),
  location: p.location,
  distanceM: p.distanceM ?? null,
  address: p.context ?? null,
});

/**
 * A route's row in the car: its time, how much longer than the fastest, its length and how much of
 * it is new. The extra time is the difference of the two times as shown, so "57 min (12 min
 * longer)" beside a "45 min" fastest always adds up.
 */
function toOption(r: Route, title: string, c: CopyCatalog, fastestS: number = r.durationS - r.extraDurationS): CarRouteOption {
  remember(r);
  const extraMin = Math.round(r.durationS / 60) - Math.round(fastestS / 60);
  const time = extraMin >= 1 ? `${formatDuration(r.durationS)} (${formatDuration(extraMin * 60)} longer)` : formatDuration(r.durationS);
  const parts = [time, formatDistanceShort(r.distanceM), r.novelty.newKm >= 0.1 ? c.newKm(r.novelty.newKm) : null];
  return { routeId: r.id, title, detail: parts.filter(Boolean).join(' · '), durationS: r.durationS, distanceM: r.distanceM, extraDurationS: r.extraDurationS, geometry: r.geometry };
}

/** Forget cached words and offered routes between tests. */
export function resetCarHandlers() {
  copyCache = null;
  offered.clear();
  lastCarFix = null;
  resetReportCooldown();
}

/** A saved place called Home, however it was written: "Home", "home 🏠", "My home", "My house". */
export function isHomeName(name: string): boolean {
  const words = name.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
  return words.length > 0 && words.length <= 2 && (words.at(-1) === 'home' || words.join(' ') === 'my house') && (words.length === 1 || words[0] === 'my');
}

/**
 * Your saved places for the car's home screen: Home first (it's where most drives end), then the
 * nearest. None when they can't be fetched: the rest of the screen still works.
 */
async function savedPlaces(near: LngLat | null): Promise<CarPlace[]> {
  const res = await api.request('api/saved-places', { schema: SavedPlaceListSchema }).catch(() => null);
  if (!res) return [];
  const isHome = isHomeName;
  return res.items
    .map((p) => ({ p, distanceM: near ? haversineM(near, p.location) : null }))
    .sort((a, b) => Number(isHome(b.p.name)) - Number(isHome(a.p.name)) || (a.distanceM ?? 0) - (b.distanceM ?? 0) || a.p.name.localeCompare(b.p.name))
    .slice(0, MAX_ROWS)
    .map(({ p, distanceM }) => ({
      id: p.id,
      name: p.name,
      // How far first: the car's row has room for one short line, and that's what a driver judges by.
      detail: [distanceM != null ? `${formatDistanceShort(distanceM)} away` : null, p.description || null].filter(Boolean).join(' · '),
      location: p.location,
      distanceM,
      saved: true,
      home: isHome(p.name),
      address: p.description || null,
    }));
}

/** How many planned routes are for driving; null when that can't be found out. */
async function plannedForCar(): Promise<number | null> {
  const res = await api.request('api/planned-routes', { schema: PlannedRouteListSchema, ...carRequest }).catch(() => null);
  return res ? res.items.filter((p) => p.route.mode === 'car').length : null;
}

export const carHandlers: CarHandlers = {
  async status(): Promise<CarStatus> {
    const signedIn = api.hasAccessToken || !!(await api.refresh());
    const account = signedIn ? 'signedIn' : (await hasSavedSession()) ? 'offline' : 'signedOut';
    const base = await getServerUrl();
    const where = await here();
    return {
      account,
      styleUrl: isServerUrl(base) ? { light: `${base}/map/style.json?theme=light`, dark: `${base}/map/style.json?theme=dark` } : null,
      searchHint: (await copy()).searchPlaceholder,
      here: where,
      saved: signedIn ? await savedPlaces(where) : [],
      plannedRoutes: signedIn ? await plannedForCar() : null,
    };
  },
  /** The limit where the car is, for its map with no trip. */
  async speedLimit(params): Promise<CarSpeedLimit> {
    const { lon, lat, headingDeg } = CarParams.speedLimit.parse(params);
    return api.request('api/roads/speed-limit', { query: { lon, lat, heading: headingDeg ?? undefined }, schema: SpeedLimitResponseSchema });
  },
  async search(params) {
    const { q } = CarParams.search.parse(params);
    const near = await here();
    const res = await api.request('api/search', { query: { q, lon: near?.[0], lat: near?.[1], limit: MAX_ROWS }, schema: SearchResponseSchema, ...carRequest });
    return { places: res.results.slice(0, MAX_ROWS).map(toPlace) };
  },

  /** What is at a point sent with no name, so the preview says where it is rather than "Chosen place" (C75). */
  async lookup(params) {
    const { at } = CarParams.lookup.parse(params);
    const res = await api.request('api/reverse', { query: { lon: at[0], lat: at[1] }, schema: ReverseResponseSchema, ...carRequest }).catch(() => null);
    return { place: res?.place ? { ...toPlace(res.place), location: at } : null };
  },

  async discover() {
    const from = await here(true);
    if (!from) throw new Error(NO_LOCATION);
    // The phone's Discover choices: its time limit and kinds of place (C31, C53).
    const choice = discoverChoices();
    const res = await api.request('api/discover', {
      query: { lon: from[0], lat: from[1], mode: 'car', maxMinutes: choice.minutes, limit: MAX_ROWS * 2, ...(choice.categories.length ? { categories: choice.categories.join(',') } : {}) },
      schema: DiscoverResponseSchema,
      ...carRequest,
    });
    // Nearest first, and nothing a short walk away: the car's list is for somewhere to drive to. How
    // new a place is stays on the phone; one short line is all a car row has room for.
    return {
      places: res.items
        .filter((i) => i.distanceM >= DISCOVER_MIN_M)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, MAX_ROWS)
        .map<CarPlace>((i) => ({
          id: i.id,
          name: i.name,
          detail: [i.withinMinutes ? `Within ${i.withinMinutes} min` : `${formatDistanceShort(i.distanceM)} away`, kindOf(i.category)].filter(Boolean).join(' · '),
          location: i.location,
          distanceM: i.distanceM,
        })),
    };
  },

  async plan(params) {
    const { to } = CarParams.plan.parse(params);
    const from = await here(true);
    if (!from) throw new Error(NO_LOCATION);
    // The extra time allowed for ways you haven't been is the person's own setting (server default).
    const [res, c] = await Promise.all([api.request('api/routes/explore', { method: 'POST', body: { from, to, mode: 'car' }, schema: ExploreRouteResponseSchema, ...carRequest }), copy()]);
    const options = [toOption(res.fastest, 'Fastest', c), ...res.explore.map((r, i) => toOption(r, exploreTitles(res.explore, res.fastest)[i]!, c, res.fastest.durationS))].slice(0, MAX_ROWS);
    const note = res.explore.length ? null : res.fastest.novelty.noveltyPct >= 90 ? c.allNewAlready : NO_OTHER_WAYS;
    return { options, note };
  },

  async planned() {
    const [res, c] = await Promise.all([api.request('api/planned-routes', { schema: PlannedRouteListSchema, ...carRequest }), copy()]);
    // Walking routes sent from the web stay on the phone.
    return { items: res.items.filter((p) => p.route.mode === 'car').slice(0, MAX_ROWS).map((p) => ({ id: p.id, name: p.name, option: toOption(p.route, p.name, c) })) };
  },

  async routeLine(params) {
    const { routeId } = CarParams.routeLine.parse(params);
    const current = navigation.getSnapshot().route;
    const r = offered.get(routeId) ?? (current?.id === routeId ? current : null);
    if (!r) throw new Error('That route is no longer available.');
    return { geometry: r.geometry };
  },

  async start(params) {
    const { routeId, destinationName } = CarParams.start.parse(params);
    const r = offered.get(routeId);
    if (!r) throw new Error(ROUTE_EXPIRED);
    navigation.start(r, { destinationName });
    // A route navigation can't follow leaves it idle with the reason; say so rather than leave the
    // car waiting on "Starting…".
    const now = navigation.getSnapshot();
    if (!now.active) throw new Error(now.error ?? 'Couldn’t start that route. Plan it again.');
    return {};
  },

  async stop() {
    navigation.stop();
    return {};
  },

  /**
   * The car's "auto drive": a test drive along the running trip, else a built-in route from where
   * the phone is. Records and uploads nothing (see simulation.ts).
   */
  async simulate() {
    const now = navigation.getSnapshot();
    // A real trip is never swapped for a pretend one: it would stop recording, and end when the
    // pretend drive "arrived".
    if (now.active && now.route && !now.simulated) return {};
    if (now.active && now.route) startTestDrive(navigation, now.route, now.destinationName);
    else {
      // A real route on the roads, so the car map doesn't draw one across houses and water (C84).
      const from = (await here()) ?? undefined;
      const real = from
        ? await api.request('api/routes/fastest', { method: 'POST', body: { from, to: testDriveTarget(from), mode: 'car' }, schema: RouteSchema, ...carRequest }).catch(() => null)
        : null;
      startTestDrive(navigation, real ?? demoRoute(from), DEMO_DESTINATION_NAME);
    }
    return {};
  },

  /**
   * "Report" in the car: one tap files a bug report with what the car was showing, where, and how
   * fast, for the driver to explain later. Typing or speaking a message can't be done while driving.
   */
  async report(params) {
    const { screenshotJpeg } = CarParams.report.parse(params);
    // Sends are limited to five an hour, shared with the phone's own feedback form: one tap each
    // minute at most, so a driver tapping in frustration doesn't use them all up.
    if (Date.now() - lastReportAt < REPORT_COOLDOWN_MS) throw new Error(REPORT_JUST_SENT);
    // Taken now, before anything is awaited, so a second tap while this one is on its way is turned
    // away too; given back below if nothing was sent.
    const previous = lastReportAt;
    lastReportAt = Date.now();
    try {
      return await sendReport(screenshotJpeg);
    } catch (e) {
      lastReportAt = previous;
      throw e;
    }
  },

  /** The car's own location, once a second: remembered for planning, and followed by a trip the phone can't locate. */
  async location(params) {
    const f = CarParams.location.parse(params);
    lastCarFix = { at: Date.now(), position: [f.lon, f.lat] };
    navigation.handleFix(
      { coords: { longitude: f.lon, latitude: f.lat, accuracy: f.accuracyM, speed: f.speedMps, heading: f.headingDeg, altitude: null, altitudeAccuracy: null }, timestamp: f.timeMs },
      'car',
    );
    return {};
  },

  async carSession(params) {
    if (CarParams.carSession.parse(params).active) timerHold.hold(TIMERS_FOR_CAR);
    else timerHold.release(TIMERS_FOR_CAR);
    return {};
  },

  async mute(params) {
    navigation.setMuted(CarParams.mute.parse(params).muted);
    return {};
  },
};

/** Files the report for [carHandlers.report]; the minute's wait is kept by the caller. */
async function sendReport(screenshotJpeg?: string): Promise<Record<string, never>> {
  // Feedback is switched on and off by an admin; say so rather than show a failure.
  const enabled = await api.request('api/config', { schema: PublicConfigSchema }).then((c) => c.feedbackEnabled, () => true);
  if (!enabled) throw new Error(REPORT_OFF);
  const now = navigation.getSnapshot();
  const position = now.position ?? (await here());
  const body: FeedbackCreate = {
    type: 'bug',
    message: carReportMessage(now),
    context: {
      screen: now.active ? 'Android Auto: driving' : 'Android Auto',
      platform: 'android',
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      device: `Android ${String(Platform.Version)}${Constants.deviceName ? ` · ${Constants.deviceName}` : ''}`.slice(0, 400),
      ...(position ? { mapView: { center: position, zoom: 17 } } : {}),
    },
    ...(screenshotJpeg ? { screenshot: { mediaType: 'image/jpeg' as const, data: screenshotJpeg } } : {}),
  };
  try {
    await api.request('api/feedback', { method: 'POST', body });
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new Error(REPORT_LIMIT, { cause: e });
    if (e instanceof ApiError && e.code === 'feedback_disabled') throw new Error(REPORT_OFF, { cause: e });
    throw e;
  }
  return {};
}

const STATUS_WORDS = { navigating: 'on the route', offRoute: 'off the route', arrived: 'arrived' } as const;

/** What the car was showing when the driver pressed Report, in words an admin can act on. */
export function carReportMessage(s: NavSnapshot, at: Date = new Date(), timeZone?: string): string {
  // The phone's own time zone (not always Brisbane's), named, so a report from interstate reads right.
  const when = at.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'long', ...(timeZone ? { timeZone } : {}) });
  const lines = [`Reported from the car at ${when}, with one tap. When it's safe, the driver can send the details from Settings → Send feedback.`];
  if (!s.active || !s.route) {
    lines.push('No trip running.');
  } else {
    const st = s.state;
    const ins = st?.nextInstruction ?? st?.currentInstruction;
    lines.push(`Trip: ${s.route.kind} route${s.destinationName ? ` to ${s.destinationName}` : ''}, ${st ? STATUS_WORDS[st.status] : 'waiting for the first position'}${s.rerouting ? ', finding a new route' : ''}.`);
    if (ins) lines.push(`Showing: "${ins.text}"${st?.distanceToNextManeuverM != null ? ` in ${formatDistanceShort(st.distanceToNextManeuverM)}` : ''}${ins.streetName ? ` (${ins.streetName})` : ''}.`);
    lines.push(`Speed limit shown: ${st?.speedLimitKmh != null ? `${st.speedLimitKmh} km/h${st.speedLimitEstimated ? ' (estimated, no sign mapped)' : ''}` : 'none'}. Speed: ${s.speedMps != null ? `${Math.round(s.speedMps * 3.6)} km/h` : 'unknown'}.`);
    if (s.headingDeg != null) lines.push(`Heading: ${Math.round(s.headingDeg)}°.`);
    if (s.error) lines.push(`Message shown: ${s.error}`);
  }
  return lines.join('\n');
}
