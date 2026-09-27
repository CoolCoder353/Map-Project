/**
 * The MapLibre wrapper, against a fake MapLibre that records sources, layers and camera moves.
 * What the map looks like in a real browser is covered by the Playwright suite.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapApi } from '../src/map/MapProvider';
import { fakeApi } from './fakeApi';
import { route } from './fixtures';

vi.unmock('../src/map/MapProvider');
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/worker.js' }));

type Handler = (e?: unknown) => void;
class FakeMap {
  static last: FakeMap;
  options: Record<string, unknown>;
  sources = new Map<string, { type: string; data: unknown; setData: (d: unknown) => void }>();
  layers: Array<{ id: string; type: string; before?: string | undefined }> = [];
  handlers = new Map<string, Handler[]>();
  layerHandlers = new Map<string, Handler[]>();
  style: { glyphs?: string; layers: Array<{ id: string; type: string }> } = { glyphs: 'x', layers: [{ id: 'place-label', type: 'symbol' }] };
  zoom: number;
  centre: { lng: number; lat: number };
  bounds = { getWest: () => 152.9, getSouth: () => -27.6, getEast: () => 153.2, getNorth: () => -27.3 };
  eased: unknown[] = [];
  fitted: unknown[] = [];
  styleSet: unknown[] = [];
  removed = false;
  hits: Array<{ properties: Record<string, unknown> }> = [];
  canvas = document.createElement('canvas');
  touchZoomRotate = { disableRotation: vi.fn() };
  constructor(options: Record<string, unknown>) {
    this.options = options;
    const c = options.center as [number, number];
    this.centre = { lng: c[0], lat: c[1] };
    this.zoom = options.zoom as number;
    FakeMap.last = this;
  }
  on(event: string, layerOrHandler: string | Handler, handler?: Handler) {
    if (typeof layerOrHandler === 'string') this.layerHandlers.set(`${event}:${layerOrHandler}`, [...(this.layerHandlers.get(`${event}:${layerOrHandler}`) ?? []), handler!]);
    else this.handlers.set(event, [...(this.handlers.get(event) ?? []), layerOrHandler]);
  }
  once(event: string, handler: Handler) {
    this.on(event, handler);
  }
  fire(event: string, e?: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(e);
  }
  fireLayer(event: string, layer: string, e?: unknown) {
    for (const h of this.layerHandlers.get(`${event}:${layer}`) ?? []) h(e);
  }
  getStyle() {
    return this.style;
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: { type: string; data: unknown }) {
    const src = { ...spec, setData: (d: unknown) => (src.data = d) };
    this.sources.set(id, src);
  }
  addLayer(layer: { id: string; type: string }, before?: string) {
    this.layers.push({ id: layer.id, type: layer.type, before });
  }
  hasImage() {
    return false;
  }
  addImage = vi.fn();
  addControl = vi.fn();
  setStyle(s: unknown) {
    this.styleSet.push(s);
  }
  getBounds() {
    return this.bounds;
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return this.centre;
  }
  easeTo(o: unknown) {
    this.eased.push(o);
  }
  fitBounds(b: unknown, o: unknown) {
    this.fitted.push([b, o]);
  }
  queryRenderedFeatures() {
    return this.hits;
  }
  getCanvas() {
    return this.canvas;
  }
  triggerRepaint() {
    this.fire('render');
  }
  remove() {
    this.removed = true;
  }
}

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  Map: vi.fn(function (this: unknown, o: Record<string, unknown>) {
    return new FakeMap(o);
  }),
  AttributionControl: vi.fn(),
  ScaleControl: vi.fn(),
}));

// jsdom has no 2D canvas; the route chip is drawn on one.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) })),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => vi.restoreAllMocks());

async function mount(opts: { coverageUrl?: string; tiles?: boolean; savedView?: unknown } = {}) {
  if (opts.savedView !== undefined) localStorage.setItem('wf.mapView', JSON.stringify(opts.savedView));
  const api = fakeApi({
    'GET /tiles/tiles.json': () => (opts.tiles === false ? new Response('', { status: 404 }) : { tiles: ['x'] }),
    'GET /api/coverage': () => ({ roads: [{ wayId: 7, geometry: [[153, -27.5], [153.01, -27.5]], recent: true, modes: 1 }], truncated: false }),
    'GET /api/admin/users/u-2/coverage': () => ({ roads: [], truncated: false }),
  });
  const { MapProvider, useMapApi } = await import('../src/map/MapProvider');
  let handle: MapApi | null = null;
  function Grab() {
    handle = useMapApi();
    return <div ref={handle.attach} />;
  }
  render(
    <MapProvider {...(opts.coverageUrl ? { coverageUrl: opts.coverageUrl } : {})}>
      <Grab />
    </MapProvider>,
  );
  await waitFor(() => expect(FakeMap.last).toBeDefined());
  const map = FakeMap.last;
  act(() => map.fire('style.load'));
  await waitFor(() => expect(handle!.ready).toBe(true));
  // A getter: the API object changes as the map's state does. Read it as `m.handle`, not destructured, when state changes.
  return { api, map, get handle() { return handle!; } };
}

describe('MapProvider', () => {
  it('starts at the last view, or all of Australia', async () => {
    const first = await mount();
    expect(first.map.options).toMatchObject({ center: [134.5, -27.5], zoom: 3.6, maxPitch: 0 });
    const second = await mount({ savedView: { center: [153, -27.4], zoom: 11 } });
    expect(second.map.options).toMatchObject({ center: [153, -27.4], zoom: 11 });
  });

  it('switches to the server’s style once tiles exist, and reports when they don’t', async () => {
    const withTiles = await mount();
    await waitFor(() => expect(withTiles.handle.tilesAvailable).toBe(true));
    expect(String(withTiles.map.styleSet[0])).toMatch(/\/map\/style\.json\?theme=light$/);
    const without = await mount({ tiles: false });
    await waitFor(() => expect(without.handle.tilesAvailable).toBe(false));
    expect(without.map.styleSet).toHaveLength(0);
  });

  it('adds every overlay, with lines under the base map’s labels', async () => {
    const { map } = await mount();
    const ids = map.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['coverage-roads', 'track', 'travelled', 'routes-selected', 'routes-alt-explore', 'route-callouts', 'search-pin', 'markers', 'marker-labels']));
    expect(map.layers.find((l) => l.id === 'coverage-roads')!.before).toBe('place-label');
    expect(map.layers.find((l) => l.id === 'markers')!.before).toBeUndefined();
    expect([...map.sources.keys()].sort()).toEqual(['coverage', 'markers', 'routeLabels', 'routes', 'search', 'track', 'travelled']);
  });

  it('skips text layers when the style has no fonts', async () => {
    FakeMap.prototype.getStyle = function (this: FakeMap) {
      return { layers: [] };
    };
    try {
      const { map } = await mount();
      expect(map.layers.map((l) => l.id)).not.toContain('marker-labels');
      expect(map.layers.map((l) => l.id)).not.toContain('route-callouts');
    } finally {
      FakeMap.prototype.getStyle = function (this: FakeMap) {
        return this.style;
      };
    }
  });

  it('draws routes with the selected one last and labels them with time and new km', async () => {
    const { map, handle } = await mount();
    const fast = route();
    const exp = route({ id: 'r-exp', kind: 'explore', durationS: 4000, novelty: { totalKm: 14, newKm: 6.24, noveltyPct: 44 }, geometry: [[153, -27.4], [153.2, -27.45], [153.1, -27.5]] });
    act(() => handle.setRoutes([exp, fast], 'r-exp', 'r-fast'));
    const routes = map.sources.get('routes')!.data as GeoJSON.FeatureCollection;
    expect(routes.features.map((f) => f.properties)).toEqual([
      { id: 'r-fast', kind: 'fastest', selected: false, hovered: true },
      { id: 'r-exp', kind: 'explore', selected: true, hovered: false },
    ]);
    const labels = (map.sources.get('routeLabels')!.data as GeoJSON.FeatureCollection).features.map((f) => f.properties!.label);
    expect(labels).toEqual(['15 min', '1 h 7 min · 6.2 km new']);
  });

  it('draws markers, the search pin and a replayed track', async () => {
    const { map, handle } = await mount();
    act(() => {
      handle.setMarkers([{ id: 'a', lngLat: [153, -27], kind: 'start', label: 'Home' }, { id: 'b', lngLat: [153.1, -27.1], kind: 'end' }]);
      handle.setSearchPin({ lngLat: [153.2, -27.2], label: 'School' });
      handle.setTrack([[153, -27], [153.1, -27.1]], [[153, -27]]);
    });
    expect((map.sources.get('markers')!.data as GeoJSON.FeatureCollection).features.map((f) => f.properties)).toEqual([
      { id: 'a', kind: 'start', label: 'Home' },
      { id: 'b', kind: 'end' },
    ]);
    expect((map.sources.get('search')!.data as GeoJSON.FeatureCollection).features[0]!.properties).toEqual({ kind: 'poi', label: 'School' });
    expect((map.sources.get('track')!.data as GeoJSON.FeatureCollection).features).toHaveLength(1);
    // A single travelled point isn't a line yet.
    expect((map.sources.get('travelled')!.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
    act(() => {
      handle.setSearchPin(null);
      handle.setTrack(null);
    });
    expect((map.sources.get('search')!.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
    expect((map.sources.get('track')!.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
  });

  it('loads travelled roads for the visible area while coverage is on, and clears them when off', async () => {
    const { api, map, handle } = await mount();
    map.zoom = 12.3;
    act(() => handle.setCoverageEnabled(true));
    await waitFor(() => expect((map.sources.get('coverage')!.data as GeoJSON.FeatureCollection).features).toHaveLength(1));
    expect(Object.fromEntries(api.calls('GET /api/coverage')[0]!.query)).toEqual({ bbox: '152.9,-27.6,153.2,-27.3', zoom: '12.5' });
    expect((map.sources.get('coverage')!.data as GeoJSON.FeatureCollection).features[0]!.properties).toEqual({ wayId: 7, recent: true, modes: 1 });
    act(() => map.fire('moveend'));
    await waitFor(() => expect(api.calls('GET /api/coverage')).toHaveLength(2));
    act(() => handle.setCoverageEnabled(false));
    expect((map.sources.get('coverage')!.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
    act(() => map.fire('moveend'));
    expect(api.calls('GET /api/coverage')).toHaveLength(2);
  });

  it('asks another endpoint for an admin viewing someone’s coverage', async () => {
    const { api, handle } = await mount({ coverageUrl: '/api/admin/users/u-2/coverage' });
    act(() => handle.setCoverageEnabled(true));
    await waitFor(() => expect(api.calls('GET /api/admin/users/u-2/coverage')).toHaveLength(1));
  });

  it('remembers the view after moving', async () => {
    const { map } = await mount();
    map.centre = { lng: 150.1, lat: -33.9 };
    map.zoom = 9;
    act(() => map.fire('moveend'));
    expect(JSON.parse(localStorage.getItem('wf.mapView')!)).toEqual({ center: [150.1, -33.9], zoom: 9 });
  });

  it('sends clicks on a route to route handlers and other clicks to map handlers', async () => {
    const { map, handle } = await mount();
    const onRoute = vi.fn();
    const onMap = vi.fn();
    const off = handle.onRouteClick(onRoute);
    handle.onClick(onMap);
    map.hits = [{ properties: { id: 'r-exp' } }];
    map.fire('click', { point: {}, lngLat: { lng: 153, lat: -27 } });
    map.hits = [];
    map.fire('click', { point: {}, lngLat: { lng: 153.5, lat: -27.5 } });
    expect(onRoute).toHaveBeenCalledWith('r-exp');
    expect(onMap).toHaveBeenCalledWith([153.5, -27.5]);
    off();
    map.hits = [{ properties: { id: 'r-exp' } }];
    map.fire('click', { point: {}, lngLat: { lng: 153, lat: -27 } });
    expect(onRoute).toHaveBeenCalledTimes(1);
  });

  it('reports hovering over a route', async () => {
    const { map, handle } = await mount();
    const onHover = vi.fn();
    handle.onRouteHover(onHover);
    map.fireLayer('mousemove', 'routes-alt', { features: [{ properties: { id: 'r-fast' } }] });
    expect(map.canvas.style.cursor).toBe('pointer');
    map.fireLayer('mouseleave', 'routes-alt');
    expect(onHover.mock.calls).toEqual([['r-fast'], [null]]);
    expect(map.canvas.style.cursor).toBe('');
  });

  it('moves the camera: fit, fly, zoom, and reports its view', async () => {
    const { map, handle } = await mount({ savedView: { center: [153.123456, -27.654321], zoom: 11.237 } });
    handle.fitTo([]);
    expect(map.fitted).toHaveLength(0);
    handle.fitTo([[153, -27]]);
    expect(map.eased.at(-1)).toMatchObject({ center: [153, -27], zoom: 14 });
    handle.fitTo([[153, -27], [153.2, -27.4], [152.9, -27.1]]);
    expect(map.fitted.at(-1)).toEqual([[[152.9, -27.4], [153.2, -27]], expect.objectContaining({ maxZoom: 16 })]);
    handle.flyTo([150, -33], 12);
    expect(map.eased.at(-1)).toMatchObject({ center: [150, -33], zoom: 12 });
    handle.zoomBy(-1);
    expect(map.eased.at(-1)).toMatchObject({ zoom: 10.237 });
    expect(handle.view()).toEqual({ center: [153.12346, -27.65432], zoom: 11.24 });
    expect(handle.center()).toEqual([153.123456, -27.654321]);
  });

  it('captures the rendered map for feedback', async () => {
    const { handle } = await mount();
    const shot = await handle.captureMap();
    expect(shot?.image).toBeInstanceOf(HTMLCanvasElement);
  });

  it('flags missing tiles from a map error, and removes the map when unmounted', async () => {
    const m = await mount();
    await waitFor(() => expect(m.handle.tilesAvailable).toBe(true));
    act(() => m.map.fire('error', { error: new Error('Failed to load tiles') }));
    await waitFor(() => expect(m.handle.tilesAvailable).toBe(false));
    cleanup();
    expect(m.map.removed).toBe(true);
  });
});
