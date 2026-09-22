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
    expect(featureToPlaces(point('n8', { amenity: 'bench' }))).toEqual([]);
    expect(featureToPlaces({ ...point('', { place: 'city', name: 'X' }), id: undefined })).toEqual([]);
  });

  it('computes representative points for polygons', () => {
    const square = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    expect(representativePoint(square)).toEqual([1, 1]);
    expect(representativePoint(null)).toBeNull();
  });

  it('keeps business type, brand, hours and tagged address parts', () => {
    const [store] = featureToPlaces(
      point('n20', { shop: 'supermarket', brand: 'Woolworths', name: 'Woolworths Dickson', opening_hours: 'Mo-Su 07:00-22:00', 'addr:suburb': 'Dickson', 'addr:state': 'ACT', 'addr:postcode': '2602' }),
    );
    expect(store).toMatchObject({ poiType: 'shop=supermarket', brand: 'Woolworths', openingHours: 'Mo-Su 07:00-22:00', suburb: 'Dickson', state: 'ACT', postcode: '2602' });
    const [fuel] = featureToPlaces(point('n21', { amenity: 'fuel', 'addr:state': 'New South Wales' }));
    expect(fuel).toBeUndefined(); // unnamed and unbranded
    const [branded] = featureToPlaces(point('n22', { amenity: 'fuel', brand: 'Ampol', 'addr:state': 'New South Wales' }));
    expect(branded).toMatchObject({ name: 'Ampol', poiType: 'amenity=fuel', state: 'NSW' });
  });

  it('uses addr:city only as a fallback, never as the suburb', () => {
    const [addr] = featureToPlaces(point('n23', { 'addr:housenumber': '1', 'addr:street': 'A Street', 'addr:city': 'Canberra' }));
    expect(addr).toMatchObject({ suburb: null, cityTag: 'Canberra', description: 'Canberra' });
  });

  it('keys streets by suburb when known, so each suburb keeps its own Main Street', () => {
    const street = (suburb: string | undefined, lon: number) =>
      featureToPlaces({ type: 'Feature', id: `w${lon}`, properties: { highway: 'residential', name: 'Main Street', ...(suburb ? { 'addr:suburb': suburb } : {}) }, geometry: { type: 'LineString', coordinates: [[lon, -35.3], [lon + 0.001, -35.3]] } })[0]!;
    expect(streetKey(street('Queanbeyan', 149.2))).toBe('main street|queanbeyan|');
    expect(streetKey(street(undefined, 149.2))).toBe('main street|14920|-3530');
  });

  it('keeps a named place that also has a street address, and the address too', () => {
    const school = featureToPlaces(
      point('w71376378', { amenity: 'school', name: 'Gumdale State School', 'addr:housenumber': '677', 'addr:street': 'New Cleveland Road', 'addr:suburb': 'Gumdale', 'addr:postcode': '4154' }),
    );
    expect(school).toHaveLength(2);
    expect(school[0]).toMatchObject({ id: 'w71376378', name: 'Gumdale State School', kind: 'poi', poiType: 'amenity=school', suburb: 'Gumdale' });
    expect(school[1]).toMatchObject({ id: 'w71376378:addr', name: '677 New Cleveland Road', kind: 'address' });

    // A category POI keeps both as well.
    const cafe = featureToPlaces(point('n5', { amenity: 'cafe', name: 'Two Before Ten', 'addr:housenumber': '1', 'addr:street': 'Marcus Clarke Street' }));
    expect(cafe.map((p) => p.kind)).toEqual(['poi', 'address']);

    // A plain address is still one record, with the plain id.
    const addr = featureToPlaces(point('n6', { 'addr:housenumber': '12', 'addr:street': 'Test Street' }));
    expect(addr).toHaveLength(1);
    expect(addr[0]).toMatchObject({ id: 'n6', kind: 'address', name: '12 Test Street' });
  });

  it('records the road class of a street, for choosing route via points', () => {
    const way = (highway: string) => ({
      type: 'Feature' as const,
      id: `w-${highway}`,
      properties: { highway, name: 'Some Way' },
      geometry: { type: 'LineString', coordinates: [[149.1, -35.3], [149.11, -35.3]] },
    });
    expect(featureToPlaces(way('residential'))[0]).toMatchObject({ kind: 'street', poiType: 'highway=residential' });
    expect(featureToPlaces(way('service'))[0]).toMatchObject({ kind: 'street', poiType: 'highway=service' });
  });
});
