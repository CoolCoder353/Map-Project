import { haversineM, type LngLat } from '@wayfinder/shared/geo';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

/** Moved less than this, "Your location" stays where it was: no new routes for GPS wobble. */
export const MOVED_M = 200;

/**
 * Where the phone is, if location access is already granted (never prompts), kept current while
 * the screen is open: the last known position at once, then a fresh fix, then each move of
 * [MOVED_M] or more. Plan, Discover and Round trip start from it, so after a drive they start
 * from where you are now, not where you were when the screen first opened. A last known position
 * of any age is used only until the fresh one comes (after a reboot there may be none at all).
 */
export function useApproxLocation(): LngLat | undefined {
  const [pos, setPos] = useState<LngLat>();
  useEffect(() => {
    let live = true;
    let watch: Location.LocationSubscription | null = null;
    const take = (loc: Location.LocationObject | null) => {
      if (!live || !loc) return;
      const next: LngLat = [loc.coords.longitude, loc.coords.latitude];
      setPos((prev) => (prev && haversineM(prev, next) < MOVED_M ? prev : next));
    };
    void (async () => {
      try {
        const { granted } = await Location.getForegroundPermissionsAsync();
        if (!granted) return;
        take(await Location.getLastKnownPositionAsync().catch(() => null));
        take(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
        const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: MOVED_M }, take);
        if (live) watch = sub;
        else sub.remove();
      } catch {
        // No position: suggestions are simply not ranked by distance.
      }
    })();
    return () => {
      live = false;
      watch?.remove();
    };
  }, []);
  return pos;
}
