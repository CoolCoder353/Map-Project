import type { LngLat } from '@wayfinder/shared/geo';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

/**
 * The phone's last known position, if location access is already granted (never prompts).
 * Used to rank search suggestions by distance when no start point is set.
 */
export function useApproxLocation(): LngLat | undefined {
  const [pos, setPos] = useState<LngLat>();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { granted } = await Location.getForegroundPermissionsAsync();
        if (!granted) return;
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
        if (live && last) setPos([last.coords.longitude, last.coords.latitude]);
      } catch {
        // No position: suggestions are simply not ranked by distance.
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return pos;
}
