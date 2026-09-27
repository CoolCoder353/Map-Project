import { type NavEvent, NavigationSession, type NavState } from '@wayfinder/nav';
import type { LngLat } from '@wayfinder/shared/geo';
import { type Route, RouteSchema } from '@wayfinder/shared/schemas';
import * as Crypto from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { sqliteQueueStore } from '../tracking/sqliteStore';
import { syncQueue } from '../tracking/sync';

export interface TurnByTurn {
  route: Route | null;
  state: NavState | null;
  rerouting: boolean;
  error: string | null;
  muted: boolean;
  setMuted(m: boolean): void;
  position: LngLat | null;
  stop(): void;
}

const KEEP_AWAKE_TAG = 'wayfinder-navigation';
/** How long to wait before asking again for a new route after one couldn't be fetched. */
export const REROUTE_RETRY_MS = 15_000;

/** Run a phone service call whose failure shouldn't stop navigation (it may throw or reject). */
function quietly(run: () => unknown) {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch {
    // ignored: see above
  }
}

/**
 * Drives a navigation session from live GPS: snaps to the route, speaks manoeuvres,
 * reroutes after repeated off-route fixes, and records the trip (source "navigation").
 */
export function useTurnByTurn(initial: Route | null): TurnByTurn {
  const [route, setRoute] = useState<Route | null>(initial);
  const [state, setState] = useState<NavState | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState<LngLat | null>(null);
  const session = useRef<NavigationSession | null>(null);
  const sessionId = useRef(Crypto.randomUUID());
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const watch = useRef<Location.LocationSubscription | null>(null);
  const reroutingNow = useRef(false);
  /** Set while off route without a new route yet, so a failed attempt is retried. */
  const pendingReroute = useRef<{ to: LngLat; via: LngLat[]; at: number } | null>(null);

  const speak = (text: string) => {
    if (mutedRef.current) return;
    quietly(() => Speech.stop());
    quietly(() => Speech.speak(text, { language: 'en-AU', rate: 1.0 }));
  };

  const reroute = useCallback(async (from: LngLat, to: LngLat, via: LngLat[]) => {
    const current = session.current;
    if (!current || reroutingNow.current) return;
    reroutingNow.current = true;
    pendingReroute.current = { to, via, at: Date.now() };
    setRerouting(true);
    try {
      const next = await api.request('api/routes/fastest', { method: 'POST', body: { from, to, via, mode: current.mode }, schema: RouteSchema });
      if (session.current !== current) return; // navigation ended while waiting
      current.replaceRoute(next);
      pendingReroute.current = null;
      setRoute(next);
      setError(null);
      speak('Route updated');
    } catch {
      setError('Couldn’t get a new route. Keep heading to the destination; trying again shortly.');
    } finally {
      reroutingNow.current = false;
      setRerouting(false);
    }
  }, []);

  const handleEvents = useCallback(
    (events: NavEvent[]) => {
      for (const e of events) {
        if (e.type === 'announce') speak(e.text);
        if (e.type === 'arrived') {
          speak('You have arrived');
          void syncQueue().catch(() => undefined);
        }
        if (e.type === 'backOnRoute') {
          pendingReroute.current = null;
          setError(null);
        }
        if (e.type === 'offRoute') void reroute(e.from, e.to, e.remainingVia);
      }
    },
    [reroute],
  );

  useEffect(() => {
    if (!initial) return;
    try {
      session.current = new NavigationSession(initial);
    } catch {
      // A route too short to follow (from and to the same place, say) must not take the app down.
      setError('This route can’t be followed. Plan it again, then start the new one.');
      return;
    }
    quietly(() => activateKeepAwakeAsync(KEEP_AWAKE_TAG));
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    const onFix = (loc: Location.LocationObject) => {
      const nav = session.current;
      if (cancelled || !nav) return;
      const { longitude: lon, latitude: lat } = loc.coords;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const fix = {
        ts: loc.timestamp,
        lon,
        lat,
        accuracyM: loc.coords.accuracy,
        speedMps: loc.coords.speed,
        headingDeg: loc.coords.heading,
      };
      setPosition([lon, lat]);
      let result: ReturnType<NavigationSession['update']>;
      try {
        result = nav.update(fix);
      } catch {
        return; // one odd fix; the next one carries on
      }
      setState(result.state);
      handleEvents(result.events);
      // Still off route after a failed attempt: ask again from here, now and then.
      const pending = pendingReroute.current;
      if (result.state.status === 'offRoute' && pending && !reroutingNow.current && Date.now() - pending.at >= REROUTE_RETRY_MS) {
        void reroute([lon, lat], pending.to, pending.via);
      }
      void sqliteQueueStore
        .append([
          {
            ...fix,
            accuracyM: fix.accuracyM ?? null,
            speedMps: fix.speedMps ?? null,
            headingDeg: fix.headingDeg ?? null,
            source: 'navigation',
            mode: nav.mode,
            sessionId: sessionId.current,
          },
        ])
        .catch(() => undefined);
    };
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) {
          setError('Navigation needs location permission.');
          return;
        }
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 1000 }, onFix);
        // Left the screen while the phone was asking or starting GPS: stop it straight away.
        if (cancelled) sub.remove();
        else watch.current = sub;
      } catch {
        if (!cancelled) setError('Can’t get your location. Check that location is switched on, then start again.');
      }
    })();
    const uploader = setInterval(() => void syncQueue().catch(() => undefined), 60_000);
    return () => {
      cancelled = true;
      clearInterval(uploader);
      sub?.remove();
      watch.current = null;
      session.current = null;
      pendingReroute.current = null;
      quietly(() => Speech.stop());
      quietly(() => deactivateKeepAwake(KEEP_AWAKE_TAG));
      void syncQueue().catch(() => undefined);
    };
  }, [initial, handleEvents, reroute]);

  return {
    route,
    state,
    rerouting,
    error,
    muted,
    setMuted,
    position,
    stop: () => {
      watch.current?.remove();
      watch.current = null;
      quietly(() => Speech.stop());
    },
  };
}
