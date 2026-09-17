import { describe, expect, it } from 'vitest';
import { featureToPlaces, poiCategory, representativePoint, streetKey } from '../../src/pipeline/osm-places.js';

const point = (id: string, properties: Record<string, string>, coords = [149.1, -35.3]) => ({
  type: 'Feature' as const,
  id,
  properties,
  geometry: { type: 'Point', coordinates: coords },
});

describe('OSM place mapping', () => {
  it('maps settlements with importance by type and population', () => {
    const [city] = featureToPlaces(point('n1', { place: 'city', name: 'Canberra', population: '450000' }));
    const [suburb] = featureToPlaces(point('n2', { place: 'suburb', name: 'Braddon' }));
    expect(city).toMatchObject({ id: 'n1', kind: 'city', description: 'City' });
    expect(suburb).toMatchObject({ kind: 'suburb', importance: 0.2 });
    expect(city!.importance).toBeGreaterThan(suburb!.importance);
  });

  it('maps discoverable POI categories', () => {
    expect(poiCategory({ tourism: 'viewpoint' })).toBe('viewpoint');
    expect(poiCategory({ natural: 'peak' })).toBe('peak');
    expect(poiCategory({ waterway: 'waterfall' })).toBe('waterfall');
    expect(poiCategory({ boundary: 'national_park' })).toBe('park');
    expect(poiCategory({ historic: 'memorial' })).toBe('historic');
    expect(poiCategory({ historic: 'no' })).toBeNull();
    expect(poiCategory({ amenity: 'bank' })).toBeNull();
    const [lookout] = featureToPlaces(point('n3', { tourism: 'viewpoint', name: 'Mt Ainslie Lookout', 'addr:suburb': 'Campbell' }));
    expect(lookout).toMatchObject({ kind: 'poi', category: 'viewpoint', description: 'Lookout, Campbell' });
  });

  it('maps named streets (not nodes), addresses and other searchable POIs; skips unnamed', () => {
    const way = {
      type: 'Feature' as const,
      id: 'w9',
      properties: { highway: 'residential', name: 'Lonsdale Street' },
      geometry: { type: 'LineString', coordinates: [[149.1, -35.3], [149.11, -35.3], [149.12, -35.3]] },
    };
    const [street] = featureToPlaces(way);
    expect(street).toMatchObject({ kind: 'street', lon: 149.11 });
    expect(streetKey(street!)).toBe('lonsdale street|14911|-3530');
    expect(featureToPlaces(point('n4', { highway: 'residential', name: 'Node Road' }))).toEqual([]);
    const [addr] = featureToPlaces(point('n5', { 'addr:housenumber': '12', 'addr:street': 'Test Street', 'addr:suburb': 'Braddon', 'addr:postcode': '2612' }));
    expect(addr).toMatchObject({ kind: 'address', name: '12 Test Street', description: 'Braddon 2612' });
    const [shop] = featureToPlaces(point('n6', { shop: 'outdoor', name: 'Paddy Pallin' }));
    expect(shop).toMatchObject({ kind: 'poi', category: null, description: 'outdoor' });
    expect(featureToPlaces(point('n7', { tourism: 'viewpoint' }))).toEqual([]);
    expect(featureToPlaces({ ...point('', { place: 'city', name: 'X' }), id: undefined })).toEqual([]);
  });

  it('computes representative points for polygons', () => {
    const square = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    expect(representativePoint(square)).toEqual([1, 1]);
    expect(representativePoint(null)).toBeNull();
  });
});
