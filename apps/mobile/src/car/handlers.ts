import { type CopyCatalog, copyFor } from '@wayfinder/shared/copy';
import type { LngLat } from '@wayfinder/shared/geo';
import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { DiscoverResponseSchema, ExploreRouteResponseSchema, type FeedbackCreate, type Place, PlannedRouteListSchema, PublicConfigSchema, type Route, SearchResponseSchema } from '@wayfinder/shared/schemas';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { api, hasSavedSession } from '../lib/api';
import { ApiError, isServerUrl } from '../lib/apiClient';
import { kindOf } from '../lib/categories';
import { getServerUrl } from '../lib/server';
import { navigation, type NavSnapshot } from '../nav/navigationService';
import type { CarHandlers } from './controller';
import { DEMO_DESTINATION_NAME, demoRoute, startTestDrive } from './simulation';
import { type CarPlace, CarParams, type CarRouteOption, type CarStatus } from './protocol';

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
 * Where you are: the phone's recent position, else the car's, else (when [fresh]) a new fix from
 * the phone. The phone says nothing when it is locked in a pocket or has not been given location;
 * the car always knows where it is, so it is used before waiting on the phone. Never prompts: the
 * car can't.
 */
async function here(fresh = false): Promise<LngLat | null> {
  const granted = await Location.getForegroundPermissionsAsync().then((p) => p.granted, () => false);
  const phone = granted ? located(await Location.getLastKnownPositionAsync({ maxAge: fresh ? 60_000 : 10 * 60_000 }).catch(() => null)) : null;
  if (phone) return phone;
  if (lastCarFix && Date.now() - lastCarFix.at <= CAR_FIX_MAX_AGE_MS) return lastCarFix.position;
  return granted && fresh ? located(await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), PHONE_FIX_WAIT_MS)) : null;
}

/** Android Auto shows about six rows while driving; never send more. */
export const MAX_ROWS = 6;
// Shown in the car: anything that sends the driver to the phone says to wait until it's safe (VI-1).
const NO_LOCATION = 'Can’t tell where you are. When it’s safe, check that location is on for Wayfinder on your phone.';

export const REPORT_COOLDOWN_MS = 60_000;
export const REPORT_JUST_SENT = 'Already reported. Wait a minute before reporting again.';
export const REPORT_LIMIT = 'Too many reports this hour. When it’s safe, use Send feedback on your phone later.';
export const REPORT_OFF = 'Reporting is switched off for now.';
let lastReportAt = -Infinity;
/** For tests: forget the last report sent. */
export const resetReportCooldown = () => {
  lastReportAt = -Infinity;
};

/** Routes the car has been offered, so "Go" can start one by id. The newest 30 are kept. */
const offered = new Map<string, Route>();
function remember(r: Route) {
  offered.delete(r.id);
  offered.set(r.id, r);
  while (offered.size > 30) offered.delete(offered.keys().next().value!);
}

const toPlace = (p: Place): CarPlace => ({
  id: p.id,
  name: p.name,
  detail: [p.context ?? p.typeLabel ?? p.description, p.distanceM != null ? `${formatDistanceShort(p.distanceM)} away` : null].filter(Boolean).join(' · '),
  location: p.location,
  distanceM: p.distanceM ?? null,
});

function toOption(r: Route, title: string, c: CopyCatalog): CarRouteOption {
  remember(r);
  const time = r.extraDurationS >= 60 ? `${formatDuration(r.durationS)} (${formatDuration(r.extraDurationS)} longer)` : formatDuration(r.durationS);
  const what = r.novelty.newKm >= 0.1 ? c.newKm(r.novelty.newKm) : formatDistanceShort(r.distanceM);
  return { routeId: r.id, title, detail: `${time} · ${what}`, durationS: r.durationS, distanceM: r.distanceM, extraDurationS: r.extraDurationS, geometry: r.geometry };
}

/** Forget cached words and offered routes between tests. */
export function resetCarHandlers() {
  copyCache = null;
  offered.clear();
  lastCarFix = null;
  resetReportCooldown();
}

export const carHandlers: CarHandlers = {
  async status(): Promise<CarStatus> {
    const signedIn = api.hasAccessToken || !!(await api.refresh());
    const account = signedIn ? 'signedIn' : (await hasSavedSession()) ? 'offline' : 'signedOut';
    const base = await getServerUrl();
    return {
      account,
      styleUrl: isServerUrl(base) ? { light: `${base}/map/style.json?theme=light`, dark: `${base}/map/style.json?theme=dark` } : null,
      searchHint: (await copy()).searchPlaceholder,
      here: await here(),
    };
  },
  async search(params) {
    const { q } = CarParams.search.parse(params);
    const near = await here();
    const res = await api.request('api/search', { query: { q, lon: near?.[0], lat: near?.[1], limit: MAX_ROWS }, schema: SearchResponseSchema });
    return { places: res.results.slice(0, MAX_ROWS).map(toPlace) };
  },

  async discover() {
    const from = await here(true);
    if (!from) throw new Error(NO_LOCATION);
    const res = await api.request('api/discover', { query: { lon: from[0], lat: from[1], mode: 'car', maxMinutes: 30, limit: MAX_ROWS }, schema: DiscoverResponseSchema });
    return {
      places: res.items.slice(0, MAX_ROWS).map<CarPlace>((i) => ({
        id: i.id,
        name: i.name,
        detail: [kindOf(i.category), `${formatDistanceShort(i.distanceM)} away`, i.areaUnexploredPct >= 50 ? `${i.areaUnexploredPct}% unexplored area` : null].filter(Boolean).join(' · '),
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
    const [res, c] = await Promise.all([api.request('api/routes/explore', { method: 'POST', body: { from, to, mode: 'car' }, schema: ExploreRouteResponseSchema }), copy()]);
    const options = [toOption(res.fastest, 'Fastest', c), ...res.explore.map((r, i) => toOption(r, `Explore ${i + 1}`, c))].slice(0, MAX_ROWS);
    const note = res.explore.length ? null : res.fastest.novelty.noveltyPct >= 90 ? c.allNewAlready : 'No other ways fit within your extra time.';
    return { options, note };
  },

  async planned() {
    const [res, c] = await Promise.all([api.request('api/planned-routes', { schema: PlannedRouteListSchema }), copy()]);
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
    if (!r) throw new Error('That route has expired. Plan it again.');
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
    if (now.active && now.route) startTestDrive(navigation, now.route, now.destinationName);
    else startTestDrive(navigation, demoRoute((await here()) ?? undefined), DEMO_DESTINATION_NAME);
    return {};
  },

  /**
   * "Report" in the car: one tap files a bug report with what the car was showing, where, and how
   * fast, for the driver to explain later. Typing or speaking a message can't be done while driving.
   */
  async report() {
    // Sends are limited to five an hour, shared with the phone's own feedback form: one tap each
    // minute at most, so a driver tapping in frustration doesn't use them all up.
    if (Date.now() - lastReportAt < REPORT_COOLDOWN_MS) throw new Error(REPORT_JUST_SENT);
    // Taken now, before anything is awaited, so a second tap while this one is on its way is turned
    // away too; given back below if nothing was sent.
    const previous = lastReportAt;
    lastReportAt = Date.now();
    try {
      return await sendReport();
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

  async mute(params) {
    navigation.setMuted(CarParams.mute.parse(params).muted);
    return {};
  },
};

/** Files the report for [carHandlers.report]; the minute's wait is kept by the caller. */
async function sendReport(): Promise<Record<string, never>> {
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
export function carReportMessage(s: NavSnapshot, at: Date = new Date()): string {
  const when = at.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'medium' });
  const lines = [`Reported from the car at ${when}, with one tap. When it's safe, the driver can send the details from Settings → Send feedback.`];
  if (!s.active || !s.route) {
    lines.push('No trip running.');
  } else {
    const st = s.state;
    const ins = st?.nextInstruction ?? st?.currentInstruction;
    lines.push(`Trip: ${s.route.kind} route${s.destinationName ? ` to ${s.destinationName}` : ''}, ${st ? STATUS_WORDS[st.status] : 'waiting for the first position'}${s.rerouting ? ', finding a new route' : ''}.`);
    if (ins) lines.push(`Showing: "${ins.text}"${st?.distanceToNextManeuverM != null ? ` in ${formatDistanceShort(st.distanceToNextManeuverM)}` : ''}${ins.streetName ? ` (${ins.streetName})` : ''}.`);
    lines.push(`Speed limit shown: ${st?.speedLimitKmh != null ? `${st.speedLimitKmh} km/h` : 'none'}. Speed: ${s.speedMps != null ? `${Math.round(s.speedMps * 3.6)} km/h` : 'unknown'}.`);
    if (s.headingDeg != null) lines.push(`Heading: ${Math.round(s.headingDeg)}°.`);
    if (s.error) lines.push(`Message shown: ${s.error}`);
  }
  return lines.join('\n');
}
