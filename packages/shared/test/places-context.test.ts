import { describe, expect, it } from 'vitest';
import { categoryTypes, expandAbbreviations, splitAddress, placeContext, placeDetail, poiTypeLabel, pointInPolygon, stateAbbreviation, stateTimeZone } from '../src/index.js';

describe('place context line', () => {
  it('gives suburb, state and postcode for things inside a suburb', () => {
    expect(placeContext({ kind: 'street', name: 'Main Street', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620' })).toBe('Queanbeyan NSW 2620');
    expect(placeContext({ kind: 'poi', name: 'Woolworths', suburb: 'Dickson', state: 'ACT', postcode: null })).toBe('Dickson ACT');
  });
  it('gives state and postcode for a suburb or town, and only the state for a city', () => {
    expect(placeContext({ kind: 'town', name: 'Queanbeyan', suburb: 'Queanbeyan', state: 'NSW', postcode: '2620' })).toBe('NSW 2620');
    expect(placeContext({ kind: 'city', name: 'Sydney', state: 'NSW', postcode: '2000' })).toBe('NSW');
    expect(placeContext({ kind: 'poi', name: 'X' })).toBe('');
  });
});

describe('states', () => {
  it('reads ISO codes first, then names', () => {
    expect(stateAbbreviation({ iso: 'AU-ACT', name: 'whatever' })).toBe('ACT');
    expect(stateAbbreviation({ name: 'Western Australia' })).toBe('WA');
    expect(stateAbbreviation({ name: 'Ontario' })).toBeNull();
  });
  it('maps states to their time zones', () => {
    expect(stateTimeZone('WA')).toBe('Australia/Perth');
    expect(stateTimeZone('ACT')).toBe('Australia/Sydney');
    expect(stateTimeZone(null)).toBe('Australia/Sydney');
  });
});

describe('category words', () => {
  it('recognises everyday words and plurals', () => {
    expect(categoryTypes('Servo')).toEqual(['amenity=fuel']);
    expect(categoryTypes(' petrol  station ')).toEqual(['amenity=fuel']);
    expect(categoryTypes('pharmacies')).toEqual(['amenity=pharmacy']);
    expect(categoryTypes('supermarkets')).toEqual(['shop=supermarket']);
    expect(categoryTypes('hardware')).toEqual(['shop=hardware', 'shop=doityourself']);
    expect(categoryTypes('Woolworths')).toBeNull();
  });
  it('labels OSM types', () => {
    expect(poiTypeLabel('amenity=fast_food')).toBe('Takeaway');
    expect(poiTypeLabel('amenity=fuel')).toBe('Petrol station');
    expect(poiTypeLabel('shop=garden_centre')).toBe('Garden centre');
    expect(poiTypeLabel('shop=yes')).toBe('Place');
    expect(poiTypeLabel(null)).toBe('Place');
  });
});

describe('pointInPolygon', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as [number, number][];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]] as [number, number][];
  it('respects holes', () => {
    expect(pointInPolygon([2, 2], [square, hole])).toBe(true);
    expect(pointInPolygon([5, 5], [square, hole])).toBe(false);
    expect(pointInPolygon([11, 5], [square])).toBe(false);
  });
});

describe('placeDetail', () => {
  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  it('joins type, context and distance', () => {
    expect(placeDetail({ description: 'x', typeLabel: 'Supermarket', context: 'Dickson ACT 2602', distanceM: 1500 }, km)).toBe('Supermarket · Dickson ACT 2602 · 1.5 km');
    expect(placeDetail({ description: 'Braddon 2612' }, km)).toBe('Braddon 2612');
    expect(placeDetail({ description: '', typeLabel: 'Street' }, km)).toBe('Street');
  });
});

describe('expandAbbreviations', () => {
  it('spells out street types but leaves a leading Saint alone', () => {
    expect(expandAbbreviations('12 Lonsdale St')).toBe('12 Lonsdale street');
    expect(expandAbbreviations('Mt. Ainslie Dr')).toBe('mount Ainslie drive');
    expect(expandAbbreviations('St Kilda Rd')).toBe('St Kilda road');
    expect(expandAbbreviations('Woolworths')).toBe('Woolworths');
  });
});

describe('splitAddress', () => {
  it('reads a postal address as the place and where it is', () => {
    expect(splitAddress('12 Wellington St, Cleveland, QLD, 4163')).toEqual({ name: '12 Wellington St', locality: 'cleveland', postcode: '4163' });
    expect(splitAddress('12 Wellington St, Cleveland QLD 4163')).toEqual({ name: '12 Wellington St', locality: 'cleveland', postcode: '4163' });
    expect(splitAddress('5 Shore St West\nCleveland Queensland 4163\nAustralia')).toEqual({ name: '5 Shore St West', locality: 'cleveland', postcode: '4163' });
    expect(splitAddress('1 Panorama Dr, Thornlands')).toEqual({ name: '1 Panorama Dr', locality: 'thornlands', postcode: null });
    expect(splitAddress('8 Smith Street Mount Cotton New South Wales 2165')).toEqual({ name: '8 Smith Street', locality: 'mount cotton', postcode: '2165' });
    expect(splitAddress('20 Boundary Rd QLD')).toEqual({ name: '20 Boundary Rd', locality: null, postcode: null });
  });

  it('leaves ordinary searches alone', () => {
    expect(splitAddress('Main Street')).toBeNull();
    expect(splitAddress('Woolworths Cleveland')).toBeNull();
    expect(splitAddress('12 Lonsdale St')).toBeNull();
    expect(splitAddress(' , ')).toBeNull();
  });
});
