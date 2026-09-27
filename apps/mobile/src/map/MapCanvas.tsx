import { Camera, type CameraRef, GeoJSONSource, Layer, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type StyleProp, Text, View, type ViewStyle } from 'react-native';
import * as Location from 'expo-location';
import { isServerUrl } from '../lib/apiClient';
import { getServerUrl } from '../lib/server';
import { MapErrorBoundary } from './MapErrorBoundary';
import { useTheme } from '../lib/theme';
import { rememberMapView } from '../lib/mapView';

export interface MapMarker {
  id: string;
  lngLat: LngLat;
  kind: 'start' | 'end' | 'poi' | 'position';
  label?: string;
}

export interface MapCanvasHandle {
  fitTo(coords: LngLat[], padding?: { top: number; bottom: number; left: number; right: number }): void;
  flyTo(center: LngLat, zoom?: number): void;
}

interface Props {
  style?: StyleProp<ViewStyle>;
  routes?: Route[];
  selectedRouteId?: string | null;
  onRoutePress?: (id: string) => void;
  markers?: MapMarker[];
  coverage?: GeoJSON.FeatureCollection | null;
  track?: LngLat[] | null;
  showUser?: boolean;
  followUser?: boolean;
  onPress?: (p: LngLat) => void;
  onRegionChange?: (bounds: [number, number, number, number], zoom: number) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The whole country, for a map with nothing particular to show yet. */
const OVERVIEW = { center: [134.5, -27.5] as LngLat, zoom: 3.6 };

/**
 * How close a map following the driver sits. Following only moves the camera to your position and
 * keeps whatever zoom the map already had, so without this a trip starts on the country overview.
 */
export const FOLLOW_ZOOM = 16;

const isLngLat = (c: LngLat | undefined): c is LngLat =>
  !!c && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

/**
 * [west, south, east, north] of the usable points, or null if there are none. A loop, not
 * Math.min(...xs): spreading a long route's tens of thousands of points overflows the stack.
 */
export function boundsOf(coords: LngLat[]): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const c of coords) {
    if (!isLngLat(c)) continue;
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return w === Infinity ? null : [w, s, e, n];
}

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { style, routes = [], selectedRouteId = null, onRoutePress, markers = [], coverage, track, showUser = true, followUser = false, onPress, onRegionChange },
  ref,
) {
  const t = useTheme();
  const camera = useRef<CameraRef>(null);
  // null while loading, '' when no server is set yet (nothing to load a map from).
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [canShowUser, setCanShowUser] = useState(false);

  useEffect(() => {
    void getServerUrl()
      .catch(() => '')
      .then((u) => {
        // A relative style URL (no server set yet) crashes the native map.
        setStyleUrl(isServerUrl(u) ? `${u}/map/style.json?theme=${t.dark ? 'dark' : 'light'}` : '');
      });
  }, [t.dark]);

  // The user-location layer asks Android for updates; rendering it without permission can take
  // the native map down, so it only appears once permission is granted.
  useEffect(() => {
    let live = true;
    void Location.getForegroundPermissionsAsync()
      .then((p) => live && setCanShowUser(p.granted))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    fitTo(coords, padding = { top: 80, bottom: 80, left: 48, right: 48 }) {
      const b = boundsOf(coords);
      if (!b) return;
      // A single point has no extent to fit; show it close up instead.
      if (b[0] === b[2] && b[1] === b[3]) camera.current?.flyTo({ center: [b[0], b[1]], zoom: 15, duration: 600 });
      else camera.current?.fitBounds(b, { padding, duration: 600 });
    },
    flyTo(center, zoom = 15) {
      if (!isLngLat(center)) return;
      camera.current?.flyTo({ center, zoom, duration: 600 });
    },
  }));

  // A line needs two points; anything shorter is invalid GeoJSON to the native map.
  const ordered = routes.filter((r) => r.geometry.length > 1).sort((a, b) => Number(a.id === selectedRouteId) - Number(b.id === selectedRouteId));
  const routeData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: ordered.map((r) => ({
      type: 'Feature',
      properties: { id: r.id, kind: r.kind, selected: r.id === selectedRouteId },
      geometry: { type: 'LineString', coordinates: r.geometry },
    })),
  };
  const markerData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: markers.map((m) => ({ type: 'Feature', properties: { kind: m.kind, label: m.label ?? '' }, geometry: { type: 'Point', coordinates: m.lngLat } })),
  };
  // Following starts close up on where the trip starts, so the map is already zoomed in before
  // the first position fix arrives; the country overview is for maps with nothing to follow.
  const start = (routes.find((r) => r.id === selectedRouteId) ?? routes[0])?.geometry[0];
  const initialView = followUser ? { center: isLngLat(start) ? start : OVERVIEW.center, zoom: FOLLOW_ZOOM } : OVERVIEW;
  const trackData: GeoJSON.FeatureCollection = track && track.length > 1
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track } }] }
    : EMPTY;

  if (styleUrl === null) return null;
  if (styleUrl === '') {
    return (
      <View style={[style, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <Text style={{ textAlign: 'center', opacity: 0.7 }}>No server set, so the map can’t load. Sign out and enter your server address.</Text>
      </View>
    );
  }
  return (
    <MapErrorBoundary>
    <Map
      style={style}
      mapStyle={styleUrl}
      attribution
      logo={false}
      compass={false}
      onPress={onPress ? (e) => onPress(e.nativeEvent.lngLat as LngLat) : undefined}
      onRegionDidChange={(e) => {
        const { bounds, zoom } = e.nativeEvent;
        if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || !Number.isFinite(zoom)) return;
        rememberMapView(bounds as [number, number, number, number], zoom);
        onRegionChange?.(bounds as [number, number, number, number], zoom);
      }}
    >
      <Camera ref={camera} initialViewState={initialView} zoom={followUser ? FOLLOW_ZOOM : undefined} trackUserLocation={followUser ? 'course' : undefined} />
      {coverage ? (
        <GeoJSONSource id="coverage" data={coverage}>
          <Layer
            id="coverage-roads"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ['case', ['get', 'recent'], t.exploreLine, t.accent], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 15, 5], 'line-opacity': 0.9 }}
          />
        </GeoJSONSource>
      ) : null}
      <GeoJSONSource id="track" data={trackData}>
        <Layer id="track-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': t.accent, 'line-width': 5 }} />
      </GeoJSONSource>
      <GeoJSONSource
        id="routes"
        data={routeData}
        onPress={onRoutePress ? (e) => {
          const id = (e.nativeEvent as unknown as { features?: GeoJSON.Feature[] }).features?.[0]?.properties?.id as string | undefined;
          if (id) onRoutePress(id);
        } : undefined}
      >
        <Layer id="routes-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': t.surface, 'line-width': ['case', ['get', 'selected'], 11, 8] }} />
        <Layer id="routes-fastest" type="line" filter={['==', ['get', 'kind'], 'fastest']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': t.accent, 'line-width': ['case', ['get', 'selected'], 7, 5], 'line-opacity': ['case', ['get', 'selected'], 1, 0.6] }} />
        <Layer id="routes-explore" type="line" filter={['!=', ['get', 'kind'], 'fastest']} layout={{ 'line-join': 'round' }} paint={{ 'line-color': t.exploreLine, 'line-width': ['case', ['get', 'selected'], 7, 5], 'line-opacity': ['case', ['get', 'selected'], 1, 0.65], 'line-dasharray': [2, 1] }} />
      </GeoJSONSource>
      <GeoJSONSource id="markers" data={markerData}>
        <Layer id="markers-circle" type="circle" paint={{ 'circle-radius': 8, 'circle-color': ['match', ['get', 'kind'], 'end', t.danger, 'poi', t.exploreLine, 'position', t.accent, t.surface], 'circle-stroke-color': ['match', ['get', 'kind'], 'start', t.text, t.surface], 'circle-stroke-width': 3 }} />
        <Layer id="markers-label" type="symbol" filter={['!=', ['get', 'label'], '']} layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true }} paint={{ 'text-color': t.text, 'text-halo-color': t.surface, 'text-halo-width': 1.5 }} />
      </GeoJSONSource>
      {showUser && canShowUser ? <UserLocation /> : null}
    </Map>
    </MapErrorBoundary>
  );
});
