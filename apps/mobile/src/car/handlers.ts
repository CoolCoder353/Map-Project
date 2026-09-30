import { type CopyCatalog, copyFor } from '@wayfinder/shared/copy';
import type { LngLat } from '@wayfinder/shared/geo';
import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { DiscoverResponseSchema, ExploreRouteResponseSchema, type Place, PlannedRouteListSchema, PublicConfigSchema, type Route, SearchResponseSchema } from '@wayfinder/shared/schemas';
import * as Location from 'expo-location';
import { api, hasSavedSession } from '../lib/api';
import { isServerUrl } from '../lib/apiClient';
import { kindOf } from '../lib/categories';
import { getServerUrl } from '../lib/server';
import { navigation } from '../nav/navigationService';
import type { CarHandlers } from './controller';
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

/** Where the phone is, or null without permission or any fix. Never prompts: the car can't. */
async function here(fresh = false): Promise<LngLat | null> {
  try {
    if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: fresh ? 60_000 : 10 * 60_000 });
    const loc = last ?? (fresh ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }) : null);
    return loc ? [loc.coords.longitude, loc.coords.latitude] : null;
  } catch {
    return null;
  }
}

/** Android Auto shows about six rows while driving; never send more. */
export const MAX_ROWS = 6;
const NO_LOCATION = 'Can’t tell where you are. Check that location is on for Wayfinder on your phone.';

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
    return {};
  },

  async stop() {
    navigation.stop();
    return {};
  },

  async mute(params) {
    navigation.setMuted(CarParams.mute.parse(params).muted);
    return {};
  },
};
