/** A MapApi that records what screens ask the map to do. See test/setup.ts. */
import type { LngLat } from '@wayfinder/shared';
import { vi } from 'vitest';
import type { MapApi } from '../src/map/MapProvider';

export interface FakeMap extends MapApi {
  /** Simulate a click on the map. */
  click(p: LngLat): void;
  clickRoute(id: string): void;
  hoverRoute(id: string | null): void;
}

export function makeFakeMap(overrides: Partial<MapApi> = {}): FakeMap {
  const clicks = new Set<(p: LngLat) => void>();
  const routeClicks = new Set<(id: string) => void>();
  const routeHovers = new Set<(id: string | null) => void>();
  const map: FakeMap = {
    ready: true,
    tilesAvailable: true,
    coverageEnabled: false,
    setRoutes: vi.fn(),
    setMarkers: vi.fn(),
    setCoverageEnabled: vi.fn(),
    setTrack: vi.fn(),
    fitTo: vi.fn(),
    flyTo: vi.fn(),
    center: vi.fn(() => [153.02, -27.47] as LngLat),
    onClick: vi.fn((h: (p: LngLat) => void) => {
      clicks.add(h);
      return () => clicks.delete(h);
    }),
    onRouteClick: vi.fn((h: (id: string) => void) => {
      routeClicks.add(h);
      return () => routeClicks.delete(h);
    }),
    onRouteHover: vi.fn((h: (id: string | null) => void) => {
      routeHovers.add(h);
      return () => routeHovers.delete(h);
    }),
    setSearchPin: vi.fn(),
    zoomBy: vi.fn(),
    view: vi.fn(() => ({ center: [153.02, -27.47] as LngLat, zoom: 12 })),
    captureMap: vi.fn(async () => null),
    attach: vi.fn(),
    click: (p) => clicks.forEach((h) => h(p)),
    clickRoute: (id) => routeClicks.forEach((h) => h(id)),
    hoverRoute: (id) => routeHovers.forEach((h) => h(id)),
    ...overrides,
  };
  return map;
}

let current = makeFakeMap();

export const currentFakeMap = () => current;

/** Install a fresh fake map for the next render and return it. */
export function useFakeMap(overrides: Partial<MapApi> = {}): FakeMap {
  current = makeFakeMap(overrides);
  return current;
}
