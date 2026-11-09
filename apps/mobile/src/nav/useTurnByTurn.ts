import type { NavState } from '@wayfinder/nav';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { navigation } from './navigationService';

export { REROUTE_RETRY_MS } from './navigationService';

export interface TurnByTurn {
  route: Route | null;
  /** Where the trip is going, as it was named. */
  destinationName: string | null;
  state: NavState | null;
  rerouting: boolean;
  error: string | null;
  muted: boolean;
  setMuted(m: boolean): void;
  /** On an explore route: the fastest way from here instead (see NavigationService.skipDetour). */
  skipDetour(): void;
  position: LngLat | null;
  /** Which way you're going, degrees clockwise from north, when known. */
  headingDeg: number | null;
  /** Speed from the last fix, metres a second, or null where the phone didn't say. */
  speedMps: number | null;
  /** Where the trip has been so far, off the route too. */
  travelled: LngLat[];
  /** A trip was running while this screen showed, and has ended (arrived and closed by itself, say). */
  ended: boolean;
  stop(): void;
}

const KEEP_AWAKE_TAG = 'wayfinder-navigation';

function quietly(run: () => unknown) {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch {
    // ignored: keep-awake failing mustn't stop navigation
  }
}

/**
 * The Navigate screen's view of the app's navigation session. Given a route, it starts following
 * it. Given none, it shows whatever trip is running (one started from the car, say). Keeps the
 * phone screen on while shown.
 *
 * Leaving the screen doesn't end the trip: only End does, or arriving. It used to, so going back
 * to look at the map, or Android closing the screen, ended a trip with no word why, on the phone
 * and the car (C63). The banner over the tabs leads back to the directions.
 */
export function useTurnByTurn(initial: Route | null, destinationName: string | null = null): TurnByTurn {
  const snap = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  // A screen showing this hook re-renders on every navigation update (position, speech, ...), and
  // some callers rebuild `initial` fresh each render; compare by the route's id, not reference, so
  // that doesn't look like a new route and restart the trip. (Not by content: that would turn the
  // whole route into text on every GPS fix.)
  const key = initial?.id ?? null;
  const [seenActive, setSeenActive] = useState(false);
  useEffect(() => {
    if (snap.active) setSeenActive(true);
  }, [snap.active]);
  useEffect(() => {
    if (initial) navigation.start(initial, { askForNotifications: true, ...(destinationName ? { destinationName } : {}) });
    quietly(() => activateKeepAwakeAsync(KEEP_AWAKE_TAG));
    return () => quietly(() => deactivateKeepAwake(KEEP_AWAKE_TAG));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the route id (`key`), not `initial`'s reference; see above.
  }, [key]);
  return {
    route: snap.route,
    destinationName: snap.destinationName,
    state: snap.state,
    rerouting: snap.rerouting,
    error: snap.error,
    muted: snap.muted,
    setMuted: navigation.setMuted,
    skipDetour: navigation.skipDetour,
    position: snap.position,
    headingDeg: snap.headingDeg,
    speedMps: snap.speedMps,
    travelled: snap.travelled,
    ended: seenActive && !snap.active,
    stop: navigation.stop,
  };
}
