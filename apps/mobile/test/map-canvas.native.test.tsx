/// <reference types="jest" />
import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { createRef } from 'react';
import { MapCanvas, type MapCanvasHandle } from '../src/map/MapCanvas';
import { lastMapView } from '../src/lib/mapView';
import { route } from './fakes';

let mockServer = 'https://maps.example.test';
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => mockServer }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })) }));
const mockCamera = { fitBounds: jest.fn(), flyTo: jest.fn() };
const mockSources: Record<string, { data: GeoJSON.FeatureCollection; onPress?: (e: unknown) => void }> = {};
let mockMapProps: Record<string, unknown> = {};
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    Map: (props: Record<string, unknown>) => {
      mockMapProps = props;
      return React.createElement(View, { testID: 'native-map' }, props.children);
    },
    Camera: React.forwardRef((_p: unknown, ref: unknown) => {
      React.useImperativeHandle(ref, () => mockCamera);
      return null;
    }),
    GeoJSONSource: (props: { id: string; data: GeoJSON.FeatureCollection; onPress?: () => void; children: unknown }) => {
      mockSources[props.id] = props;
      return props.children;
    },
    Layer: () => null,
    UserLocation: () => React.createElement(Text, null, 'user-location'),
  };
});

beforeEach(() => {
  mockServer = 'https://maps.example.test';
  for (const k of Object.keys(mockSources)) delete mockSources[k];
  jest.clearAllMocks();
});

it('loads the server’s map style', async () => {
  await render(<MapCanvas />);
  await screen.findByTestId('native-map');
  expect(mockMapProps.mapStyle).toBe('https://maps.example.test/map/style.json?theme=light');
});

it('explains a missing server instead of crashing the native map', async () => {
  mockServer = '';
  await render(<MapCanvas />);
  expect(await screen.findByText(/No server set, so the map can’t load/)).toBeOnTheScreen();
  expect(screen.queryByTestId('native-map')).toBeNull();
});

it('shows your position only once location permission is granted', async () => {
  await render(<MapCanvas />);
  await screen.findByTestId('native-map');
  expect(screen.queryByText('user-location')).toBeNull();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
  await render(<MapCanvas />);
  expect(await screen.findByText('user-location')).toBeOnTheScreen();
});

it('draws routes with the selected one last, markers, the track and travelled roads', async () => {
  const onRoutePress = jest.fn();
  const coverage: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  await render(
    <MapCanvas
      routes={[route({ id: 'a' }), route({ id: 'b', kind: 'explore' })]}
      selectedRouteId="a"
      onRoutePress={onRoutePress}
      markers={[{ id: 's', lngLat: [153, -27], kind: 'start', label: 'Home' }, { id: 'e', lngLat: [153.1, -27.1], kind: 'end' }]}
      track={[[153, -27], [153.1, -27.1]]}
      coverage={coverage}
    />,
  );
  await screen.findByTestId('native-map');
  expect(mockSources.routes!.data.features.map((f) => f.properties)).toEqual([
    { id: 'b', kind: 'explore', selected: false },
    { id: 'a', kind: 'fastest', selected: true },
  ]);
  expect(mockSources.markers!.data.features.map((f) => f.properties)).toEqual([{ kind: 'start', label: 'Home' }, { kind: 'end', label: '' }]);
  expect(mockSources.track!.data.features).toHaveLength(1);
  expect(mockSources.coverage!.data).toBe(coverage);
  mockSources.routes!.onPress!({ nativeEvent: { features: [{ properties: { id: 'b' } }] } });
  mockSources.routes!.onPress!({ nativeEvent: { features: [] } });
  expect(onRoutePress.mock.calls).toEqual([['b']]);
});

it('leaves out travelled roads when none are given, and a one-point track', async () => {
  await render(<MapCanvas track={[[153, -27]]} />);
  await screen.findByTestId('native-map');
  expect(mockSources.coverage).toBeUndefined();
  expect(mockSources.track!.data.features).toHaveLength(0);
});

it('moves the camera: fit to points, fly to a place', async () => {
  const ref = createRef<MapCanvasHandle>();
  await render(<MapCanvas ref={ref} />);
  await screen.findByTestId('native-map');
  ref.current!.fitTo([]);
  expect(mockCamera.fitBounds).not.toHaveBeenCalled();
  ref.current!.fitTo([[153, -27], [153.2, -27.4], [152.9, -27.1]]);
  expect(mockCamera.fitBounds).toHaveBeenCalledWith([152.9, -27.4, 153.2, -27], expect.objectContaining({ duration: 600 }));
  ref.current!.flyTo([150, -33]);
  expect(mockCamera.flyTo).toHaveBeenCalledWith({ center: [150, -33], zoom: 15, duration: 600 });
});

it('reports taps and remembers the view after moving', async () => {
  const onPress = jest.fn();
  const onRegionChange = jest.fn();
  await render(<MapCanvas onPress={onPress} onRegionChange={onRegionChange} />);
  await screen.findByTestId('native-map');
  await act(async () => (mockMapProps.onPress as (e: unknown) => void)({ nativeEvent: { lngLat: [153, -27] } }));
  expect(onPress).toHaveBeenCalledWith([153, -27]);
  await act(async () => (mockMapProps.onRegionDidChange as (e: unknown) => void)({ nativeEvent: { bounds: [153, -27.6, 153.2, -27.4], zoom: 12 } }));
  expect(onRegionChange).toHaveBeenCalledWith([153, -27.6, 153.2, -27.4], 12);
  await waitFor(() => expect(lastMapView()).toEqual({ center: [153.1, -27.5], zoom: 12 }));
});

it('fits a very long route without overflowing, and skips points that aren’t on Earth', async () => {
  const ref = createRef<MapCanvasHandle>();
  await render(<MapCanvas ref={ref} />);
  await screen.findByTestId('native-map');
  // Spread into Math.min, 300,000 points overflow the stack.
  const long: Array<[number, number]> = Array.from({ length: 300_000 }, (_, i) => [150 + i / 100_000, -30 + i / 100_000]);
  long.push([Number.NaN, 0], [999, -27]);
  ref.current!.fitTo(long);
  expect(mockCamera.fitBounds).toHaveBeenCalledWith([150, -30, 152.99999, -27.00001], expect.anything());
  ref.current!.fitTo([[Number.NaN, Number.NaN]]);
  expect(mockCamera.fitBounds).toHaveBeenCalledTimes(1);
});

it('shows a single point close up instead of fitting an empty box', async () => {
  const ref = createRef<MapCanvasHandle>();
  await render(<MapCanvas ref={ref} />);
  await screen.findByTestId('native-map');
  ref.current!.fitTo([[153, -27], [153, -27]]);
  expect(mockCamera.fitBounds).not.toHaveBeenCalled();
  expect(mockCamera.flyTo).toHaveBeenCalledWith({ center: [153, -27], zoom: 15, duration: 600 });
  ref.current!.flyTo([Number.NaN, 0]);
  expect(mockCamera.flyTo).toHaveBeenCalledTimes(1);
});

it('ignores a map move that arrives without a usable view', async () => {
  const onRegionChange = jest.fn();
  await render(<MapCanvas onRegionChange={onRegionChange} />);
  await screen.findByTestId('native-map');
  await act(async () => (mockMapProps.onRegionDidChange as (e: unknown) => void)({ nativeEvent: { zoom: 12 } }));
  await act(async () => (mockMapProps.onRegionDidChange as (e: unknown) => void)({ nativeEvent: { bounds: [153, Number.NaN, 153.2, -27.4], zoom: 12 } }));
  expect(onRegionChange).not.toHaveBeenCalled();
});

it('leaves out a route line with fewer than two points', async () => {
  await render(<MapCanvas routes={[route({ id: 'ok' }), route({ id: 'dot', geometry: [[153, -27]] })]} />);
  await screen.findByTestId('native-map');
  expect(mockSources.routes!.data.features.map((f) => f.properties!.id)).toEqual(['ok']);
});

it('treats a half-typed server address as no server', async () => {
  mockServer = 'https://';
  await render(<MapCanvas />);
  expect(await screen.findByText(/No server set/)).toBeOnTheScreen();
});
