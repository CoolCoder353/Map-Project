import { describe, expect, it } from 'vitest';
import { categoryTypes, placeContext, placeDetail, poiTypeLabel, pointInPolygon, stateAbbreviation, stateTimeZone } from '../src/index.js';

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
    expect(poiTypeLabel('amenity=fast_food')).toBe('Fast food');
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
