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
  setRoutes(routes: Route[], selectedId: string | null, hoveredId?: string | null): void;
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
  onRouteHover(handler: (routeId: string | null) => void): () => void;
  setSearchPin(p: { lngLat: LngLat; label: string } | null): void;
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
  const p = panelPadding();
  return [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
}

/** Insets so fitted content isn't hidden under the floating panel, the bottom sheet or the banner. */
function panelPadding() {
  const panel = document.querySelector('.panel')?.getBoundingClientRect();
  const banner = document.querySelector('.map-banner')?.getBoundingClientRect();
  const top = Math.max(48, (banner?.bottom ?? 0) + 24);
  if (window.innerWidth >= 900) {
    return { top, bottom: 56, left: (panel?.right ?? 416) + 40, right: 80 };
  }
  const sheetTop = panel?.top ?? window.innerHeight * 0.42;
  // Room below the lowest marker for its label, the scale bar and the attribution pill.
  return { top, bottom: Math.max(96, window.innerHeight - sheetTop + 96), left: 40, right: 72 };
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
    search: EMPTY,
    routeLabels: EMPTY,
  });
  const clickHandlers = useRef(new Set<(p: LngLat) => void>());
  const routeClickHandlers = useRef(new Set<(id: string) => void>());
  const routeHoverHandlers = useRef(new Set<(id: string | null) => void>());
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
    const hasGlyphs = !!map.getStyle().glyphs;
    for (const id of Object.keys(data.current) as Array<keyof typeof data.current>) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data.current[id] });
    }

    // Coverage: unexplored land is fogged; explored cells are cut out of the fog, tinted and
    // outlined (so the difference is lightness + outline, not hue alone). Cells first reached in
    // the last week get a heavier explore-green outline.
    map.addLayer({
      id: 'fog',
      type: 'fill',
      source: 'fog',
      paint: { 'fill-color': dark ? '#000000' : '#26303a', 'fill-opacity': dark ? 0.62 : 0.34 },
    });
    map.addLayer({
      id: 'coverage-fill',
      type: 'fill',
      source: 'coverage',
      paint: {
        'fill-color': accent,
        'fill-opacity': ['interpolate', ['linear'], ['get', 'fraction'], 0, dark ? 0.1 : 0.06, 1, dark ? 0.32 : 0.22],
      },
    });
    map.addLayer({
      id: 'coverage-line',
      type: 'line',
      source: 'coverage',
      paint: { 'line-color': accent, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 15, 1.4] },
    });
    map.addLayer({
      id: 'coverage-recent',
      type: 'line',
      source: 'coverage',
      filter: ['>', ['get', 'recent'], 0],
      paint: { 'line-color': explore, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 15, 3] },
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

    // Routes. Type is carried by colour AND pattern at every state: fastest = solid blue,
    // explore = dashed green. Unselected routes are thinner and translucent; hover thickens.
    const isFastest = ['==', ['get', 'kind'], 'fastest'] as ExpressionSpecification;
    const width = (base: number) => ['case', ['get', 'hovered'], base + 2, base] as ExpressionSpecification;
    map.addLayer({
      id: 'routes-alt-casing',
      type: 'line',
      source: 'routes',
      filter: ['!', ['get', 'selected']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': surface, 'line-width': width(8), 'line-opacity': 0.9 },
    });
    map.addLayer({
      id: 'routes-alt',
      type: 'line',
      source: 'routes',
      filter: ['all', ['!', ['get', 'selected']], isFastest],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-width': width(5), 'line-opacity': 0.6 },
    });
    map.addLayer({
      id: 'routes-alt-explore',
      type: 'line',
      source: 'routes',
      filter: ['all', ['!', ['get', 'selected']], ['!', isFastest]],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': explore, 'line-width': width(5), 'line-opacity': 0.65, 'line-dasharray': [2, 1] },
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
      filter: ['all', ['get', 'selected'], isFastest],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-width': 7 },
    });
    map.addLayer({
      id: 'routes-selected-explore',
      type: 'line',
      source: 'routes',
      filter: ['all', ['get', 'selected'], ['!', isFastest]],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': explore, 'line-width': 7, 'line-dasharray': [2, 0.6] },
    });
    if (hasGlyphs) {
      // Route callouts: text chips placed beside each line (not along it), selected first.
      if (!map.hasImage('chip')) {
        const ratio = 2;
        const size = 24 * ratio;
        const r = 8 * ratio;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = surface;
        ctx.strokeStyle = dark ? '#4a5057' : '#c7cbd1';
        ctx.lineWidth = 1.5 * ratio;
        ctx.beginPath();
        ctx.roundRect(ctx.lineWidth, ctx.lineWidth, size - 2 * ctx.lineWidth, size - 2 * ctx.lineWidth, r);
        ctx.fill();
        ctx.stroke();
        map.addImage('chip', ctx.getImageData(0, 0, size, size), {
          pixelRatio: ratio,
          stretchX: [[r, size - r]],
          stretchY: [[r, size - r]],
          content: [r / 2, r / 2, size - r / 2, size - r / 2],
        });
      }
      const calloutLayout = (selected: boolean) => ({
        'icon-image': 'chip',
        'icon-text-fit': 'both' as const,
        'icon-text-fit-padding': [3, 7, 3, 7] as [number, number, number, number],
        'text-field': ['get', 'label'] as ExpressionSpecification,
        'text-font': ['Noto Sans Bold'],
        'text-size': selected ? 13 : 12,
        // Chip centred on the label point (a bubble over the line, as in other map apps).
        // The selected route's chip always shows; others give way when they would collide.
        'text-allow-overlap': selected,
        'icon-allow-overlap': selected,
      });
      const calloutPaint = {
        'text-color': ['case', ['==', ['get', 'kind'], 'fastest'], accent, cssVar('--explore') || explore] as ExpressionSpecification,
      };
      map.addLayer({ id: 'route-callouts', type: 'symbol', source: 'routeLabels', filter: ['!', ['get', 'selected']], layout: calloutLayout(false), paint: calloutPaint });
      map.addLayer({ id: 'route-callouts-selected', type: 'symbol', source: 'routeLabels', filter: ['get', 'selected'], layout: calloutLayout(true), paint: calloutPaint });
    }

    // Place picked from the panel search
    map.addLayer({
      id: 'search-pin',
      type: 'circle',
      source: 'search',
      paint: { 'circle-radius': 8, 'circle-color': cssVar('--danger') || '#c5221f', 'circle-stroke-color': surface, 'circle-stroke-width': 3 },
    });
    if (hasGlyphs) {
      map.addLayer({
        id: 'search-pin-label',
        type: 'symbol',
        source: 'search',
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': text, 'text-halo-color': surface, 'text-halo-width': 1.5 },
      });
    }

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
    if (hasGlyphs) {
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
        properties: { fraction: c.fraction, recent: c.recent },
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
    for (const layer of ['routes-alt', 'routes-alt-explore']) {
      map.on('mousemove', layer, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const id = e.features?.[0]?.properties?.id as string | undefined;
        routeHoverHandlers.current.forEach((h) => h(id ?? null));
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        routeHoverHandlers.current.forEach((h) => h(null));
      });
    }

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
      setRoutes(routes, selectedId, hoveredId = null) {
        // Draw selected last so it sits on top within its layer.
        const ordered = [...routes].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
        const minutes = (sec: number) =>
          sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : `${Math.round(sec / 60)} min`;
        const labelFor = (r: Route) =>
          r.novelty.newKm >= 0.1
            ? `${minutes(r.durationS)} · ${r.novelty.newKm.toFixed(r.novelty.newKm < 10 ? 1 : 0)} km new`
            : minutes(r.durationS);
        setSource('routes', {
          type: 'FeatureCollection',
          features: ordered.map((r) => ({
            type: 'Feature',
            properties: { id: r.id, kind: r.kind, selected: r.id === selectedId, hovered: r.id === hoveredId },
            geometry: { type: 'LineString', coordinates: r.geometry },
          })),
        });
        // One chip per route at a point where the routes are furthest apart, offset to the
        // outside of the bundle. On narrow screens only the selected route is labelled.
        const narrow = window.innerWidth < 900;
        const labelled = narrow ? ordered.filter((r) => r.id === selectedId) : ordered;
        const centroid = routes.length
          ? routes
              .map((r) => r.geometry[Math.floor(r.geometry.length / 2)]!)
              .reduce<[number, number]>((acc, p) => [acc[0] + p[0] / routes.length, acc[1] + p[1] / routes.length], [0, 0])
          : [0, 0];
        setSource('routeLabels', {
          type: 'FeatureCollection',
          features: labelled.map((r) => {
            let best = r.geometry[Math.floor(r.geometry.length / 2)]!;
            let bestD = -1;
            for (let i = Math.floor(r.geometry.length * 0.25); i < r.geometry.length * 0.75; i += Math.max(1, Math.floor(r.geometry.length / 40))) {
              const p = r.geometry[i]!;
              const d = Math.min(
                ...routes.filter((o) => o.id !== r.id).map((o) => Math.min(...o.geometry.filter((_, k) => k % 5 === 0).map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))),
                Infinity,
              );
              if (d > bestD) {
                bestD = d;
                best = p;
              }
            }
            const east = best[0] >= (centroid[0] ?? 0);
            return {
              type: 'Feature',
              properties: {
                kind: r.kind,
                selected: r.id === selectedId,
                label: labelFor(r),
                anchor: east ? 'left' : 'right',
                offset: east ? [1.1, 0] : [-1.1, 0],
                iconOffset: east ? [12, 0] : [-12, 0],
              },
              geometry: { type: 'Point', coordinates: best },
            };
          }),
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
      onRouteHover(handler) {
        routeHoverHandlers.current.add(handler);
        return () => routeHoverHandlers.current.delete(handler);
      },
      setSearchPin(p) {
        setSource(
          'search',
          p
            ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'poi', label: p.label }, geometry: { type: 'Point', coordinates: p.lngLat } }] }
            : EMPTY,
        );
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
