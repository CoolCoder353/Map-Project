import { Camera, type CameraRef, GeoJSONSource, Layer, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { LngLat } from '@wayfinder/shared/geo';
import { type LightState, lightsAhead } from '@wayfinder/shared/light-timing';
import { cumulativeM } from '@wayfinder/shared/road-facts';
import type { Route } from '@wayfinder/shared/schemas';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type StyleProp, Text, View, type ViewStyle } from 'react-native';
import * as Location from 'expo-location';
import { LocateFixed } from 'lucide-react-native';
import { Press } from '../ui/kit';
import { isServerUrl } from '../lib/apiClient';
import { getServerUrl } from '../lib/server';
import { MapErrorBoundary } from './MapErrorBoundary';
import { useTheme } from '../lib/theme';
import { lastMapView, rememberMapView } from '../lib/mapView';
import { routeLabelPoints } from './routeLabels';

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
  /** A label on each route's line ("24 min", as on its card), so a line can be matched to its card (U5). */
  routeLabels?: Record<string, string>;
  /** A road on the coverage map tapped: what the server says about it (when it was travelled, P99). */
  onCoveragePress?: (road: Record<string, unknown>) => void;
  /** A marker tapped: its id (Discover's pins lead to their cards, P47). */
  onMarkerPress?: (id: string) => void;
  markers?: MapMarker[];
  coverage?: GeoJSON.FeatureCollection | null;
  track?: LngLat[] | null;
  showUser?: boolean;
  followUser?: boolean;
  onPress?: (p: LngLat) => void;
  onRegionChange?: (bounds: [number, number, number, number], zoom: number) => void;
  /**
   * Traffic lights to mark red (you'll likely have to stop) or green (likely not). Left out, the
   * selected route's lights with a known timing are marked as if setting off now.
   */
  lights?: ReadonlyArray<{ at: LngLat; state: LightState }>;
  /**
   * With [followUser]: where navigation says you are and which way you're going. The map follows
   * this, turned to your direction, and marks it, rather than relying on the phone's own location
   * layer, which showed nothing and stayed north up when navigation followed the car (P27, P85).
   */
  follow?: { at: LngLat; headingDeg: number | null } | null;
  /** The map for directions: no buildings, place dots or light markers, and the route in one colour (P21, P28, P86). */
  driving?: boolean;
}

/** Route lines sit under this layer of the server's style, so place names stay readable over them (P7). */
export const ROUTES_BELOW = 'place-suburb';

/** Red and green as the lights themselves are, the same in light and dark. */
export const LIGHT_COLOURS: Record<LightState, string> = { red: '#d93025', green: '#188038' };

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The whole country, for a map with nothing particular to show yet. */
const OVERVIEW = { center: [134.5, -27.5] as LngLat, zoom: 3.6 };

/**
 * How close a map following the driver sits. Following only moves the camera to your position and
 * keeps whatever zoom the map already had, so without this a trip starts on the country overview.
 */
export const FOLLOW_ZOOM = 16;
/** How close a map with nothing else to show opens on where you are: your part of town. */
export const NEARBY_ZOOM = 11;
/** How close "Show my location" goes. */
export const MINE_ZOOM = 14;
/** What a screen reader says for the map, in place of MapLibre's own English instructions. */
export const MAP_LABEL = 'Map';

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
  { style, routes = [], selectedRouteId = null, onRoutePress, routeLabels, onMarkerPress, onCoveragePress, markers = [], coverage, track, showUser = true, followUser = false, onPress, onRegionChange, lights, follow, driving = false },
  ref,
) {
  const t = useTheme();
  const camera = useRef<CameraRef>(null);
  // null while loading, '' when no server is set yet (nothing to load a map from).
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [canShowUser, setCanShowUser] = useState(false);
  // Following you until the map is dragged away; Re-centre picks it up again.
  const [following, setFollowing] = useState(true);
  // Following a position navigation gives is done here; only without one does the native map follow the phone.
  const tracking = followUser && following && follow === undefined;
  const followAt = followUser && following && follow && isLngLat(follow.at) ? follow : null;
  // By value, not the object: a new one comes with every navigation update.
  const followLon = followAt?.at[0];
  const followLat = followAt?.at[1];
  const followHeading = followAt?.headingDeg ?? null;
  useEffect(() => {
    if (followLon === undefined || followLat === undefined || !styleUrl) return;
    camera.current?.easeTo({ center: [followLon, followLat], ...(followHeading != null ? { bearing: followHeading } : {}), duration: 800 });
  }, [followLon, followLat, followHeading, styleUrl]);

  useEffect(() => {
    void getServerUrl()
      .catch(() => '')
      .then((u) => {
        // A relative style URL (no server set yet) crashes the native map.
        setStyleUrl(isServerUrl(u) ? `${u}/map/style.json?theme=${t.dark ? 'dark' : 'light'}${driving ? '&driving=1' : ''}` : '');
      });
  }, [t.dark, driving]);

  // The user-location layer asks Android for updates; rendering it without permission can take
  // the native map down, so it only appears once permission is granted.
  // A map with nothing of its own to show opens where you are, not on the whole country.
  const empty = !followUser && routes.length === 0 && markers.length === 0 && !coverage && !track?.length;
  useEffect(() => {
    let live = true;
    void Location.getForegroundPermissionsAsync()
      .then((p) => live && setCanShowUser(p.granted))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // Once the native map (and its camera) is there.
  const openedNearby = useRef(false);
  useEffect(() => {
    if (!styleUrl || !canShowUser || !empty || openedNearby.current || lastMapView()) return;
    openedNearby.current = true;
    let live = true;
    void Location.getLastKnownPositionAsync()
      .then((here) => {
        if (live && here) camera.current?.flyTo({ center: [here.coords.longitude, here.coords.latitude], zoom: NEARBY_ZOOM, duration: 0 });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [styleUrl, canShowUser, empty]);

  /** "Show my location" on a map that isn't following you: there, close up. */
  const showMine = async () => {
    const here = await Location.getLastKnownPositionAsync().catch(() => null);
    if (here) camera.current?.flyTo({ center: [here.coords.longitude, here.coords.latitude], zoom: MINE_ZOOM, duration: 600 });
  };

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
      // Driving, the route is the one line to follow, drawn as the car draws it whatever its kind.
      properties: { id: r.id, kind: driving ? 'fastest' : r.kind, selected: r.id === selectedRouteId },
      geometry: { type: 'LineString', coordinates: r.geometry },
    })),
  };
  const labelAt = routeLabels ? routeLabelPoints(ordered) : null;
  const labelData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: ordered.flatMap((r) => {
      const at = labelAt?.get(r.id);
      const text = routeLabels?.[r.id];
      return at && text ? [{ type: 'Feature' as const, properties: { id: r.id, text, kind: r.kind, selected: r.id === selectedRouteId }, geometry: { type: 'Point' as const, coordinates: at } }] : [];
    }),
  };
  const markerData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: markers.map((m) => ({ type: 'Feature', properties: { id: m.id, kind: m.kind, label: m.label ?? '' }, geometry: { type: 'Point', coordinates: m.lngLat } })),
  };
  // Following starts close up on where the trip starts, so the map is already zoomed in before
  // the first position fix arrives; the country overview is for maps with nothing to follow.
  const start = (routes.find((r) => r.id === selectedRouteId) ?? routes[0])?.geometry[0];
  // Not following: where any map was last left, else the country until your position is known.
  const initialView = followUser ? { center: isLngLat(start) ? start : OVERVIEW.center, zoom: FOLLOW_ZOOM } : (lastMapView() ?? OVERVIEW);
  const chosen = routes.find((r) => r.id === selectedRouteId);
  const shownLights = lights ?? (chosen && chosen.geometry.length > 1 ? lightsAhead(chosen, cumulativeM(chosen.geometry), 0, Date.now(), Infinity) : []);
  const lightData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: shownLights.map((l) => ({ type: 'Feature', properties: { state: l.state }, geometry: { type: 'Point', coordinates: l.at } })),
  };
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
      accessibilityLabel={MAP_LABEL}
      mapStyle={styleUrl}
      attribution
      logo={false}
      compass={false}
      onPress={onPress ? (e) => onPress(e.nativeEvent.lngLat as LngLat) : undefined}
      onRegionWillChange={follow !== undefined ? (e) => {
        // Dragged away while following: left there until Re-centre.
        if (e.nativeEvent.userInteraction) setFollowing(false);
      } : undefined}
      attributionPosition={{ bottom: 20, left: 8 }}
      onRegionDidChange={(e) => {
        const { bounds, zoom } = e.nativeEvent;
        if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || !Number.isFinite(zoom)) return;
        rememberMapView(bounds as [number, number, number, number], zoom);
        onRegionChange?.(bounds as [number, number, number, number], zoom);
      }}
    >
      <Camera
        ref={camera}
        initialViewState={initialView}
        zoom={tracking ? FOLLOW_ZOOM : undefined}
        trackUserLocation={tracking ? 'course' : undefined}
        onTrackUserLocationChange={followUser ? (e) => setFollowing(e.nativeEvent.trackUserLocation !== null) : undefined}
      />
      {coverage ? (
        <GeoJSONSource
          id="coverage"
          data={coverage}
          onPress={onCoveragePress ? (e) => {
            const props = (e.nativeEvent as unknown as { features?: GeoJSON.Feature[] }).features?.[0]?.properties;
            if (props) onCoveragePress(props);
          } : undefined}
        >
          <Layer
            id="coverage-roads"
            beforeId={ROUTES_BELOW}
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ['case', ['get', 'recent'], t.exploreLine, t.accent], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 15, 5], 'line-opacity': 0.9 }}
          />
        </GeoJSONSource>
      ) : null}
      <GeoJSONSource id="track" data={trackData}>
        <Layer id="track-line" beforeId={ROUTES_BELOW} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': t.accent, 'line-width': 5 }} />
      </GeoJSONSource>
      <GeoJSONSource
        id="routes"
        data={routeData}
        onPress={onRoutePress ? (e) => {
          const id = (e.nativeEvent as unknown as { features?: GeoJSON.Feature[] }).features?.[0]?.properties?.id as string | undefined;
          if (id) onRoutePress(id);
        } : undefined}
      >
        <Layer id="routes-casing" beforeId={ROUTES_BELOW} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': t.surface, 'line-width': ['case', ['get', 'selected'], 11, 8] }} />
        <Layer id="routes-fastest" beforeId={ROUTES_BELOW} type="line" filter={['==', ['get', 'kind'], 'fastest']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': t.accent, 'line-width': ['case', ['get', 'selected'], 7, 5], 'line-opacity': ['case', ['get', 'selected'], 1, 0.6] }} />
        <Layer id="routes-explore" beforeId={ROUTES_BELOW} type="line" filter={['==', ['get', 'kind'], 'explore']} layout={{ 'line-join': 'round' }} paint={{ 'line-color': t.exploreLine, 'line-width': ['case', ['get', 'selected'], 7, 5], 'line-opacity': ['case', ['get', 'selected'], 1, 0.65], 'line-dasharray': [2, 1] }} />
        {/* Loops overlap: the chosen one solid and on top, the others grey and thin, so each can be told apart (P68). */}
        <Layer id="routes-loop" beforeId={ROUTES_BELOW} type="line" filter={['==', ['get', 'kind'], 'roundtrip']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ['case', ['get', 'selected'], t.exploreLine, t.text2], 'line-width': ['case', ['get', 'selected'], 7, 3], 'line-opacity': ['case', ['get', 'selected'], 1, 0.5] }} />
      </GeoJSONSource>
      <GeoJSONSource
        id="route-labels"
        data={labelData}
        onPress={onRoutePress ? (e) => {
          const id = (e.nativeEvent as unknown as { features?: GeoJSON.Feature[] }).features?.[0]?.properties?.id as string | undefined;
          if (id) onRoutePress(id);
        } : undefined}
      >
        {/* Each route's time on its line, in its own colour: which line is which card (U5). */}
        <Layer
          id="route-labels-text"
          type="symbol"
          layout={{ 'text-field': ['get', 'text'], 'text-font': ['Noto Sans Bold'], 'text-size': ['case', ['get', 'selected'], 15, 13], 'text-allow-overlap': true, 'text-ignore-placement': true, 'symbol-sort-key': ['case', ['get', 'selected'], 1, 0] }}
          paint={{ 'text-color': ['case', ['==', ['get', 'kind'], 'fastest'], t.accent, t.explore], 'text-halo-color': t.surface, 'text-halo-width': 3 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="route-lights" data={lightData}>
        <Layer
          id="route-lights-circle"
          type="circle"
          minzoom={12}
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8],
            'circle-color': ['match', ['get', 'state'], 'red', LIGHT_COLOURS.red, LIGHT_COLOURS.green],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id="markers"
        data={markerData}
        onPress={onMarkerPress ? (e) => {
          const id = (e.nativeEvent as unknown as { features?: GeoJSON.Feature[] }).features?.[0]?.properties?.id as string | undefined;
          if (id) onMarkerPress(id);
        } : undefined}
      >
        <Layer id="markers-circle" type="circle" paint={{ 'circle-radius': ['case', ['==', ['get', 'kind'], 'poi'], 11, 8], 'circle-color': ['match', ['get', 'kind'], 'end', t.danger, 'poi', t.exploreLine, 'position', t.accent, t.surface], 'circle-stroke-color': ['match', ['get', 'kind'], 'start', t.text, t.surface], 'circle-stroke-width': 3 }} />
        {/* A place's number inside its pin, always shown: beside it, numbers collided or were dropped (U8). */}
        <Layer id="markers-number" type="symbol" filter={['all', ['==', ['get', 'kind'], 'poi'], ['!=', ['get', 'label'], '']]} layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': t.surface }} />
        <Layer id="markers-label" type="symbol" filter={['all', ['!=', ['get', 'kind'], 'poi'], ['!=', ['get', 'label'], '']]} layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true }} paint={{ 'text-color': t.text, 'text-halo-color': t.surface, 'text-halo-width': 1.5 }} />
      </GeoJSONSource>
      {showUser && canShowUser ? <UserLocation /> : null}
    </Map>
    {followUser && !following ? (
      <Press
        accessibilityRole="button"
        accessibilityLabel="Re-centre"
        onPress={() => setFollowing(true)}
        style={({ hovered }) => ({
          position: 'absolute',
          // Top right: the speed sign has the top left, and notices the bottom (Navigate).
          right: 12,
          top: 12,
          minWidth: 48,
          minHeight: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: hovered ? t.surface2 : t.surface,
          elevation: 3,
        })}
      >
        <LocateFixed size={24} color={t.accent} />
      </Press>
    ) : null}
    {!followUser && showUser && canShowUser ? (
      <Press
        accessibilityRole="button"
        accessibilityLabel="Show my location"
        onPress={() => void showMine()}
        style={({ hovered }) => ({
          position: 'absolute',
          right: 12,
          top: 12,
          minWidth: 48,
          minHeight: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: hovered ? t.surface2 : t.surface,
          elevation: 3,
        })}
      >
        <LocateFixed size={24} color={t.accent} />
      </Press>
    ) : null}
    </MapErrorBoundary>
  );
});
