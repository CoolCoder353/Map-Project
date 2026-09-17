import type { LngLat, Place } from '@wayfinder/shared';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { type MapMarker, useMapApi } from '../map/MapProvider';
import { placeFromPoint, usePlanner } from './PlannerState';

/** While a field is in "choose on map" mode, the next map click fills it (named by reverse geocoding). */
export function usePickOnMap() {
  const map = useMapApi();
  const planner = usePlanner();
  const { pickTarget, setPickTarget } = planner;
  useEffect(() => {
    if (!pickTarget) return;
    const off = map.onClick(async (p: LngLat) => {
      const setter = {
        from: planner.setFrom,
        to: planner.setTo,
        loopStart: planner.setLoopStart,
        discoverOrigin: planner.setDiscoverOrigin,
      }[pickTarget];
      setPickTarget(null);
      setter(placeFromPoint(p));
      try {
        const { place } = await api<{ place: Place | null }>('/api/reverse', { query: { lon: p[0], lat: p[1] } });
        if (place) setter({ name: place.name, description: place.description, location: p });
      } catch {
        // keep the dropped pin name
      }
    });
    document.body.classList.add('is-picking');
    return () => {
      off();
      document.body.classList.remove('is-picking');
    };
  }, [pickTarget, map, planner.setFrom, planner.setTo, planner.setLoopStart, planner.setDiscoverOrigin, setPickTarget]);
}

/** Clear the map overlays a panel owns when it unmounts. */
export function useOverlayCleanup() {
  const map = useMapApi();
  useEffect(
    () => () => {
      map.setRoutes([], null);
      map.setMarkers([]);
      map.setTrack(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

export type { MapMarker };
