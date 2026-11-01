import { describe, expect, it } from 'vitest';
import { featureToSignal, featureToWayRule } from '../../src/pipeline/osm-roads.js';

const node = (id: string, properties: Record<string, string>) => ({ type: 'Feature' as const, id, properties, geometry: { type: 'Point', coordinates: [153.02, -27.47] } });
const way = (id: string, properties: Record<string, string>) => ({
  type: 'Feature' as const,
  id,
  properties,
  geometry: { type: 'LineString', coordinates: [[153.0, -27.4], [153.01, -27.4], [153.02, -27.4]] },
});

describe('traffic lights from OSM', () => {
  it('tells junction lights, crossings and ramp meters apart', () => {
    expect(featureToSignal(node('n1', { highway: 'traffic_signals' }))).toEqual({ id: 1, lon: 153.02, lat: -27.47, kind: 'signals' });
    expect(featureToSignal(node('n2', { highway: 'crossing', crossing: 'traffic_signals' }))?.kind).toBe('crossing');
    expect(featureToSignal(node('n3', { highway: 'traffic_signals', traffic_signals: 'crossing_only' }))?.kind).toBe('crossing');
    expect(featureToSignal(node('n4', { highway: 'traffic_signals', traffic_signals: 'ramp_meter' }))?.kind).toBe('ramp_meter');
  });

  it('leaves out lights that don’t stop traffic as usual, and what isn’t a light', () => {
    expect(featureToSignal(node('n5', { highway: 'traffic_signals', traffic_signals: 'blinker' }))).toBeNull();
    expect(featureToSignal(node('n6', { highway: 'traffic_signals', traffic_signals: 'emergency' }))).toBeNull();
    expect(featureToSignal(node('n7', { highway: 'crossing', crossing: 'zebra' }))).toBeNull();
    expect(featureToSignal(way('w8', { highway: 'traffic_signals' }))).toBeNull();
    expect(featureToSignal({ ...node('x9', { highway: 'traffic_signals' }) })).toBeNull();
  });
});

describe('speed-limit rules from OSM', () => {
  it('keeps school zones and roads with electronic signs, with a point to place them', () => {
    expect(featureToWayRule(way('w1', { 'maxspeed:conditional': ' 40 @ (Mo-Fr 07:00-09:00) ' }))).toEqual({
      wayId: 1,
      conditional: '40 @ (Mo-Fr 07:00-09:00)',
      variable: false,
      point: [153.01, -27.4],
    });
    expect(featureToWayRule(way('w2', { maxspeed: '100', 'maxspeed:variable': 'obstruction' }))).toMatchObject({ variable: true, conditional: null });
    expect(featureToWayRule(way('w3', { maxspeed: 'signals' }))).toMatchObject({ variable: true });
  });

  it('skips ways with neither, and anything that isn’t a way', () => {
    expect(featureToWayRule(way('w4', { maxspeed: '60', 'maxspeed:variable': 'no' }))).toBeNull();
    expect(featureToWayRule(node('n5', { 'maxspeed:conditional': '40 @ (Mo-Fr 07:00-09:00)' }))).toBeNull();
  });
});
