import { describe, expect, it } from 'vitest';
import { featureToSignal, featureToWayLanes, featureToWayRule } from '../../src/pipeline/osm-roads.js';

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

describe('lane markings from OSM', () => {
  it('takes turn:lanes as the way’s own direction on a one-way road, and against it for oneway=-1', () => {
    expect(featureToWayLanes(way('w1', { highway: 'primary', oneway: 'yes', 'turn:lanes': 'left|through' }))).toEqual({
      wayId: 1,
      forward: 'left|through',
      backward: null,
      coords: [[153.0, -27.4], [153.01, -27.4], [153.02, -27.4]],
    });
    expect(featureToWayLanes(way('w2', { highway: 'primary', oneway: '-1', 'turn:lanes': 'left|through' }))).toMatchObject({ forward: null, backward: 'left|through' });
    // A motorway is one-way without saying so.
    expect(featureToWayLanes(way('w3', { highway: 'motorway', 'turn:lanes': 'through|through|slight_right' }))).toMatchObject({ forward: 'through|through|slight_right' });
  });

  it('on a two-way road takes only the lanes tagged for a direction', () => {
    expect(featureToWayLanes(way('w4', { highway: 'secondary', 'turn:lanes:forward': 'left|through', 'turn:lanes:backward': 'through|right' }))).toMatchObject({
      forward: 'left|through',
      backward: 'through|right',
    });
    // Plain turn:lanes on a two-way road doesn't say which side it's for.
    expect(featureToWayLanes(way('w5', { highway: 'secondary', 'turn:lanes': 'left|through' }))).toBeNull();
    expect(featureToWayLanes(way('w6', { highway: 'secondary' }))).toBeNull();
    expect(featureToWayLanes(node('n7', { 'turn:lanes': 'left|through' }))).toBeNull();
  });
});
