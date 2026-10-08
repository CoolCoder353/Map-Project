import type { NavState } from '@wayfinder/nav';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { navigation } from './navigationService';

export { REROUTE_RETRY_MS } from './navigationService';

export interface TurnByTurn {
  route: Route | null;
  state: NavState | null;
  rerouting: boolean;
  error: string | null;
  muted: boolean;
  setMuted(m: boolean): void;
  position: LngLat | null;
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
 * it and ends the trip when the screen closes. Given none, it shows whatever trip is running
 * (one started from the car, say). Keeps the phone screen on while shown.
 */
export function useTurnByTurn(initial: Route | null): TurnByTurn {
  const snap = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  // A screen showing this hook re-renders on every navigation update (position, speech, ...), and
  // some callers rebuild `initial` fresh each render; compare by the route's id, not reference, so
  // that doesn't look like a new route and restart the trip. (Not by content: that would turn the
  // whole route into text on every GPS fix.)
  const key = initial?.id ?? null;
  const seenActive = useRef(false);
  if (snap.active) seenActive.current = true;
  useEffect(() => {
    if (initial) navigation.start(initial, { askForNotifications: true });
    quietly(() => activateKeepAwakeAsync(KEEP_AWAKE_TAG));
    return () => {
      if (initial) navigation.stop();
      quietly(() => deactivateKeepAwake(KEEP_AWAKE_TAG));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the route id (`key`), not `initial`'s reference; see above.
  }, [key]);
  return {
    route: snap.route,
    state: snap.state,
    rerouting: snap.rerouting,
    error: snap.error,
    muted: snap.muted,
    setMuted: navigation.setMuted,
    position: snap.position,
    travelled: snap.travelled,
    ended: seenActive.current && !snap.active,
    stop: navigation.stop,
  };
}
