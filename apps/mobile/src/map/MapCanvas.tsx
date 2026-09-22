import { Camera, type CameraRef, GeoJSONSource, Layer, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { LngLat } from '@wayfinder/shared/geo';
import type { Route } from '@wayfinder/shared/schemas';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { getServerUrl } from '../lib/server';
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

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { style, routes = [], selectedRouteId = null, onRoutePress, markers = [], coverage, track, showUser = true, followUser = false, onPress, onRegionChange },
  ref,
) {
  const t = useTheme();
  const camera = useRef<CameraRef>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);

  useEffect(() => {
    void getServerUrl().then((u) => setStyleUrl(`${u}/map/style.json?theme=${t.dark ? 'dark' : 'light'}`));
  }, [t.dark]);

  useImperativeHandle(ref, () => ({
    fitTo(coords, padding = { top: 80, bottom: 80, left: 48, right: 48 }) {
      if (coords.length === 0) return;
      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      camera.current?.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], { padding, duration: 600 });
    },
    flyTo(center, zoom = 15) {
      camera.current?.flyTo({ center, zoom, duration: 600 });
    },
  }));

  const ordered = [...routes].sort((a, b) => Number(a.id === selectedRouteId) - Number(b.id === selectedRouteId));
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
  const trackData: GeoJSON.FeatureCollection = track && track.length > 1
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track } }] }
    : EMPTY;

  if (!styleUrl) return null;
  return (
    <Map
      style={style}
      mapStyle={styleUrl}
      attribution
      logo={false}
      compass={false}
      onPress={onPress ? (e) => onPress(e.nativeEvent.lngLat as LngLat) : undefined}
      onRegionDidChange={(e) => {
        const bounds = e.nativeEvent.bounds as [number, number, number, number];
        rememberMapView(bounds, e.nativeEvent.zoom);
        onRegionChange?.(bounds, e.nativeEvent.zoom);
      }}
    >
      <Camera ref={camera} initialViewState={{ center: [134.5, -27.5], zoom: 3.6 }} trackUserLocation={followUser ? 'course' : undefined} />
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
      {showUser ? <UserLocation /> : null}
    </Map>
  );
});
