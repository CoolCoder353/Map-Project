import { type NavEvent, NavigationSession, type NavState } from '@wayfinder/nav';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
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

  const speak = (text: string) => {
    if (mutedRef.current) return;
    Speech.stop();
    Speech.speak(text, { language: 'en-AU', rate: 1.0 });
  };

  const handleEvents = useCallback(async (events: NavEvent[]) => {
    for (const e of events) {
      if (e.type === 'announce') speak(e.text);
      if (e.type === 'arrived') {
        speak('You have arrived');
        void syncQueue();
      }
      if (e.type === 'offRoute' && session.current) {
        setRerouting(true);
        try {
          const next = await api.request<Route>('api/routes/fastest', {
            method: 'POST',
            body: { from: e.from, to: e.to, via: e.remainingVia, mode: session.current.mode },
          });
          session.current.replaceRoute(next);
          setRoute(next);
          speak('Route updated');
        } catch {
          setError('Couldn’t get a new route. Keep heading to the destination; retrying when you’re back online.');
        } finally {
          setRerouting(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!initial) return;
    session.current = new NavigationSession(initial);
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError('Navigation needs location permission.');
        return;
      }
      watch.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 1000 },
        (loc) => {
          if (cancelled || !session.current) return;
          const fix = {
            ts: loc.timestamp,
            lon: loc.coords.longitude,
            lat: loc.coords.latitude,
            accuracyM: loc.coords.accuracy,
            speedMps: loc.coords.speed,
            headingDeg: loc.coords.heading,
          };
          setPosition([fix.lon, fix.lat]);
          const { state: s, events } = session.current.update(fix);
          setState(s);
          void handleEvents(events);
          void sqliteQueueStore.append([
            {
              ...fix,
              accuracyM: fix.accuracyM ?? null,
              speedMps: fix.speedMps ?? null,
              headingDeg: fix.headingDeg ?? null,
              source: 'navigation',
              mode: session.current.mode,
              sessionId: sessionId.current,
            },
          ]);
        },
      );
    })();
    const uploader = setInterval(() => void syncQueue().catch(() => undefined), 60_000);
    return () => {
      cancelled = true;
      clearInterval(uploader);
      watch.current?.remove();
      Speech.stop();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      void syncQueue().catch(() => undefined);
    };
  }, [initial, handleEvents]);

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
      Speech.stop();
    },
  };
}
