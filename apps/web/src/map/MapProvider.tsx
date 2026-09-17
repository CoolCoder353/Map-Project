import type { CoverageResponse, LngLat, Route } from '@wayfinder/shared';
import { cellToBoundary } from 'h3-js';
import * as maplibregl from 'maplibre-gl';
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
  MapMouseEvent,
} from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../lib/api';

export type MarkerKind = 'start' | 'end' | 'via' | 'poi' | 'me' | 'position';

export interface MapMarker {
  id: string;
  lngLat: LngLat;
  kind: MarkerKind;
  label?: string;
}

interface MapApi {
  ready: boolean;
  tilesAvailable: boolean | null;
  setRoutes(routes: Route[], selectedId: string | null): void;
  setMarkers(markers: MapMarker[]): void;
  setCoverageEnabled(enabled: boolean): void;
  coverageEnabled: boolean;
  setTrack(line: LngLat[] | null, travelled?: LngLat[] | null): void;
  fitTo(coords: LngLat[], maxZoom?: number): void;
  flyTo(center: LngLat, zoom?: number): void;
  center(): LngLat;
  /** Subscribe to map clicks; returns an unsubscribe function. */
  onClick(handler: (p: LngLat) => void): () => void;
  onRouteClick(handler: (routeId: string) => void): () => void;
  zoomBy(delta: number): void;
  attach(container: HTMLDivElement | null): void;
}

const MapContext = createContext<MapApi | null>(null);

const VIEW_KEY = 'wf.mapView';
const DEFAULT_VIEW = { center: [134.5, -27.5] as LngLat, zoom: 3.6 };

function readView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { center: LngLat; zoom: number };
      if (Array.isArray(v.center) && typeof v.zoom === 'number') return v;
    }
  } catch {
    // storage unavailable
  }
  return DEFAULT_VIEW;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const prefersDark = () => {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Centre offset for point moves. (Passing `padding` to easeTo would persist on the map and
 * shrink every later fitBounds, so only fitBounds gets padding.)
 */
function panelOffset(inset: boolean): [number, number] {
  if (!inset) return [0, 0];
  return window.innerWidth >= 900 ? [228, 0] : [0, -140];
}

/** Left inset so fitted content isn't hidden under the floating panel. */
function panelPadding() {
  const wide = window.innerWidth >= 900;
  return wide
    ? { top: 64, bottom: 64, left: 400 + 56, right: 72 }
    : { top: 80, bottom: 280, left: 32, right: 32 };
}

export function MapProvider({
  children,
  coverageUrl = '/api/coverage',
  insetForPanel = true,
}: {
  children: ReactNode;
  /** Endpoint returning CoverageResponse for ?bbox&zoom (admins inspect another user's). */
  coverageUrl?: string;
  /** Leave room for the floating planner panel when fitting content. */
  insetForPanel?: boolean;
}) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesAvailable, setTilesAvailable] = useState<boolean | null>(null);
  const [coverageEnabled, setCoverageEnabledState] = useState(false);
  const data = useRef({
    routes: EMPTY,
    markers: EMPTY,
    coverage: EMPTY,
    fog: EMPTY,
    track: EMPTY,
    travelled: EMPTY,
  });
  const clickHandlers = useRef(new Set<(p: LngLat) => void>());
  const routeClickHandlers = useRef(new Set<(id: string) => void>());
  const coverageAbort = useRef<AbortController | null>(null);
  const coverageOn = useRef(false);

  const setSource = useCallback((id: keyof typeof data.current, fc: GeoJSON.FeatureCollection) => {
    data.current[id] = fc;
    const src = mapRef.current?.getSource(id) as GeoJSONSource | undefined;
    src?.setData(fc);
  }, []);

  const addOverlays = useCallback((map: maplibregl.Map) => {
    const accent = cssVar('--accent') || '#1765cc';
    const explore = cssVar('--explore-line') || '#13985f';
    const surface = cssVar('--surface') || '#ffffff';
    const text = cssVar('--text') || '#1d2126';
    const dark = prefersDark();
    for (const id of Object.keys(data.current) as Array<keyof typeof data.current>) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data.current[id] });
    }

    // Coverage: unexplored land sits under a light fog; explored cells are clear with a thin outline.
    map.addLayer({
      id: 'fog',
      type: 'fill',
      source: 'fog',
      paint: { 'fill-color': dark ? '#0b0d10' : '#5d6670', 'fill-opacity': dark ? 0.45 : 0.28 },
    });
    map.addLayer({
      id: 'coverage-fill',
      type: 'fill',
      source: 'coverage',
      paint: {
        'fill-color': accent,
        'fill-opacity': ['interpolate', ['linear'], ['get', 'fraction'], 0, 0.04, 1, 0.16],
      },
    });
    map.addLayer({
      id: 'coverage-line',
      type: 'line',
      source: 'coverage',
      paint: {
        'line-color': accent,
        'line-opacity': 0.55,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 15, 1],
      },
    });

    // Recorded track (trip replay)
    map.addLayer({
      id: 'track',
      type: 'line',
      source: 'track',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': text, 'line-opacity': 0.35, 'line-width': 5 },
    });
    map.addLayer({
      id: 'travelled',
      type: 'line',
      source: 'travelled',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-width': 5 },
    });

    // Routes: unselected under selected; explore routes dashed so type isn't colour-only.
    const routeColor = [
      'case',
      ['==', ['get', 'kind'], 'fastest'],
      accent,
      explore,
    ] as ExpressionSpecification;
    map.addLayer({
      id: 'routes-alt-casing',
      type: 'line',
      source: 'routes',
      filter: ['!', ['get', 'selected']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': surface, 'line-width': 8 },
    });
    map.addLayer({
      id: 'routes-alt',
      type: 'line',
      source: 'routes',
      filter: ['!', ['get', 'selected']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#6d747c' : '#9aa1a9', 'line-width': 5 },
    });
    map.addLayer({
      id: 'routes-selected-casing',
      type: 'line',
      source: 'routes',
      filter: ['get', 'selected'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#0b0d10' : '#ffffff', 'line-width': 11 },
    });
    map.addLayer({
      id: 'routes-selected',
      type: 'line',
      source: 'routes',
      filter: ['all', ['get', 'selected'], ['==', ['get', 'kind'], 'fastest']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeColor, 'line-width': 7 },
    });
    map.addLayer({
      id: 'routes-selected-explore',
      type: 'line',
      source: 'routes',
      filter: ['all', ['get', 'selected'], ['!=', ['get', 'kind'], 'fastest']],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': routeColor, 'line-width': 7, 'line-dasharray': [2, 0.6] },
    });

    // Markers as circles + labels (no sprite sheet)
    map.addLayer({
      id: 'markers',
      type: 'circle',
      source: 'markers',
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'via', 5, 'me', 7, 'position', 8, 7],
        'circle-color': [
          'match',
          ['get', 'kind'],
          'end',
          cssVar('--danger') || '#c5221f',
          'poi',
          explore,
          'me',
          accent,
          'position',
          accent,
          surface,
        ],
        'circle-stroke-color': ['match', ['get', 'kind'], 'start', text, 'via', text, surface],
        'circle-stroke-width': ['match', ['get', 'kind'], 'me', 3, 'position', 3, 2.5],
      },
    });
    if (map.getStyle().glyphs) {
      map.addLayer({
        id: 'marker-labels',
        type: 'symbol',
        source: 'markers',
        filter: ['has', 'label'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': text, 'text-halo-color': surface, 'text-halo-width': 1.5 },
      });
    }
  }, []);

  const refreshCoverage = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !coverageOn.current) return;
    coverageAbort.current?.abort();
    const ctrl = new AbortController();
    coverageAbort.current = ctrl;
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(5));
    // Clamp to valid ranges (the map may wrap the antimeridian)
    const clamp = (v: string, lim: number) => String(Math.max(-lim, Math.min(lim, Number(v))));
    try {
      const res = await api<CoverageResponse>(coverageUrl, {
        query: {
          bbox: [
            clamp(bbox[0]!, 180),
            clamp(bbox[1]!, 90),
            clamp(bbox[2]!, 180),
            clamp(bbox[3]!, 90),
          ].join(','),
          zoom: Math.round(map.getZoom() * 2) / 2,
        },
        signal: ctrl.signal,
      });
      const features = res.cells.map<GeoJSON.Feature>((c) => ({
        type: 'Feature',
        properties: { fraction: c.fraction },
        geometry: { type: 'Polygon', coordinates: [cellToBoundary(c.h3, true)] },
      }));
      setSource('coverage', { type: 'FeatureCollection', features });
      // Fog: a world polygon with explored cells cut out as holes.
      const holes = res.cells
        .filter((c) => c.fraction >= 0.5)
        .map((c) => cellToBoundary(c.h3, true).slice().reverse());
      setSource('fog', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-180, -85],
                  [180, -85],
                  [180, 85],
                  [-180, 85],
                  [-180, -85],
                ],
                ...holes,
              ],
            },
          },
        ],
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.warn('coverage failed', err);
    }
  }, [setSource, coverageUrl]);

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => setContainer(el), []);

  // Create the map in an effect (not the ref callback) so StrictMode's mount/unmount/remount
  // and route changes always leave exactly one live map on the current container.
  useEffect(() => {
    if (!container) return;
    const view = readView();
    const styleUrl = () =>
      `${window.location.origin}/map/style.json?theme=${prefersDark() ? 'dark' : 'light'}`;
    // Until the server has built tiles, use a bare style so overlays (routes, coverage) still render.
    const fallbackStyle = (): maplibregl.StyleSpecification => ({
      version: 8,
      glyphs: `${window.location.origin}/map/assets/fonts/{fontstack}/{range}.pbf`,
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': prefersDark() ? '#1b1e22' : '#e9ebe6' },
        },
      ],
    });
    let tilesOk = true;
    const map = new maplibregl.Map({
      container,
      style: fallbackStyle(),
      center: view.center,
      zoom: view.zoom,
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
    });
    void fetch('/tiles/tiles.json')
      .then((r) => {
        tilesOk = r.ok;
        setTilesAvailable(r.ok);
        if (r.ok) map.setStyle(styleUrl());
      })
      .catch(() => setTilesAvailable(false));
    if (import.meta.env.DEV) (window as unknown as { __wfMap?: unknown }).__wfMap = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '© OpenStreetMap contributors',
      }),
      'bottom-left',
    );
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;

    map.on('style.load', () => {
      addOverlays(map);
      setReady(true);
      // Panels may have enabled coverage before the map existed.
      if (coverageOn.current) void refreshCoverage();
    });
    map.on('error', (e) => {
      // Style or tiles unavailable (tiles not built yet) shouldn't crash the app.
      if (String(e.error?.message ?? '').includes('tiles')) setTilesAvailable(false);
    });
    map.on('moveend', () => {
      try {
        const c = map.getCenter();
        localStorage.setItem(
          VIEW_KEY,
          JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }),
        );
      } catch {
        // ignore
      }
      void refreshCoverage();
    });
    map.on('click', (e: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, {
        layers: ['routes-alt', 'routes-selected', 'routes-selected-explore'],
      });
      const routeId = hit[0]?.properties?.id as string | undefined;
      if (routeId) {
        routeClickHandlers.current.forEach((h) => h(routeId));
        return;
      }
      clickHandlers.current.forEach((h) => h([e.lngLat.lng, e.lngLat.lat]));
    });
    map.on('mouseenter', 'routes-alt', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'routes-alt', () => (map.getCanvas().style.cursor = ''));

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      setReady(false);
      map.setStyle(styleUrl());
    };
    mq.addEventListener('change', onScheme);

    return () => {
      mq.removeEventListener('change', onScheme);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [container, addOverlays, refreshCoverage]);

  const value = useMemo<MapApi>(
    () => ({
      ready,
      tilesAvailable,
      coverageEnabled,
      attach,
      setRoutes(routes, selectedId) {
        // Draw selected last so it sits on top within its layer.
        const ordered = [...routes].sort(
          (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
        );
        setSource('routes', {
          type: 'FeatureCollection',
          features: ordered.map((r) => ({
            type: 'Feature',
            properties: { id: r.id, kind: r.kind, selected: r.id === selectedId },
            geometry: { type: 'LineString', coordinates: r.geometry },
          })),
        });
      },
      setMarkers(markers) {
        setSource('markers', {
          type: 'FeatureCollection',
          features: markers.map((m) => ({
            type: 'Feature',
            properties: { id: m.id, kind: m.kind, ...(m.label ? { label: m.label } : {}) },
            geometry: { type: 'Point', coordinates: m.lngLat },
          })),
        });
      },
      setCoverageEnabled(enabled) {
        coverageOn.current = enabled;
        setCoverageEnabledState(enabled);
        if (enabled) void refreshCoverage();
        else {
          setSource('coverage', EMPTY);
          setSource('fog', EMPTY);
        }
      },
      setTrack(line, travelled) {
        setSource(
          'track',
          line
            ? {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: line },
                  },
                ],
              }
            : EMPTY,
        );
        setSource(
          'travelled',
          travelled && travelled.length > 1
            ? {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: travelled },
                  },
                ],
              }
            : EMPTY,
        );
      },
      fitTo(coords, maxZoom = 16) {
        const map = mapRef.current;
        if (!map || coords.length === 0) return;
        if (coords.length === 1) {
          map.easeTo({
            center: coords[0]!,
            zoom: Math.max(map.getZoom(), 14),
            offset: panelOffset(insetForPanel),
            duration: 600,
          });
          return;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of coords) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        map.fitBounds(
          [
            [minX, minY],
            [maxX, maxY],
          ] as LngLatBoundsLike,
          { padding: insetForPanel ? panelPadding() : 40, maxZoom, duration: 700 },
        );
      },
      flyTo(center, zoom = 15) {
        mapRef.current?.easeTo({
          center,
          zoom,
          offset: panelOffset(insetForPanel),
          duration: 700,
        });
      },
      center() {
        const c = mapRef.current?.getCenter();
        return c ? [c.lng, c.lat] : DEFAULT_VIEW.center;
      },
      onClick(handler) {
        clickHandlers.current.add(handler);
        return () => clickHandlers.current.delete(handler);
      },
      onRouteClick(handler) {
        routeClickHandlers.current.add(handler);
        return () => routeClickHandlers.current.delete(handler);
      },
      zoomBy(delta) {
        const map = mapRef.current;
        if (map) map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
      },
    }),
    [ready, tilesAvailable, coverageEnabled, attach, setSource, refreshCoverage, insetForPanel],
  );

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMapApi(): MapApi {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error('useMapApi outside MapProvider');
  return ctx;
}
