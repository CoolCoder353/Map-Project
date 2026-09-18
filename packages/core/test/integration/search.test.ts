import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
import * as places from '../../src/services/places.js';
import { type TestDb, createTestDb } from '../helpers/db.js';

let t: TestDb;
const braddon: LngLat = [149.135, -35.271];
const queanbeyan: LngLat = [149.232, -35.354];
const friday = new Date('2026-09-18T02:30:00Z'); // 12:30 pm in Canberra

beforeAll(async () => {
  t = await createTestDb();
  const stores: places.PlaceInput[] = Array.from({ length: 400 }, (_, i) => {
    // Spread across the continent, all at least 200 km from Braddon.
    const [lon, lat] = destination(braddon, (i * 137) % 360, 200_000 + (i % 40) * 50_000);
    return { id: `far${i}`, name: 'Woolworths', kind: 'poi', category: null, description: 'supermarket', lon, lat, importance: 0.05, poiType: 'shop=supermarket', state: 'NSW' };
  });
  const near = (id: string, name: string, bearing: number, m: number, extra: Partial<places.PlaceInput> = {}): places.PlaceInput => {
    const [lon, lat] = destination(braddon, bearing, m);
    return { id, name, kind: 'poi', category: null, description: '', lon, lat, importance: 0.05, ...extra };
  };
  await places.upsertPlaces(t.db, [
    ...stores,
    near('w1', 'Woolworths', 0, 1500, { poiType: 'shop=supermarket', suburb: 'Dickson', state: 'ACT', postcode: '2602', openingHours: 'Mo-Su 07:00-22:00' }),
    near('w2', 'Woolworths', 200, 4000, { poiType: 'shop=supermarket', suburb: 'Civic', state: 'ACT', postcode: '2601' }),
    near('f1', 'Ampol Braddon', 90, 800, { poiType: 'amenity=fuel', brand: 'Ampol', suburb: 'Braddon', state: 'ACT', postcode: '2612' }),
    near('f2', 'Caltex Dickson', 30, 3000, { poiType: 'amenity=fuel', brand: 'Ampol', suburb: 'Dickson', state: 'ACT' }),
    near('c1', 'Petrol Heads Cafe', 180, 500, { poiType: 'amenity=cafe', suburb: 'Braddon', state: 'ACT' }),
    near('s1', 'Sydney Avenue', 180, 2500, { kind: 'street', suburb: 'Barton', state: 'ACT', postcode: '2600' }),
    { id: 'syd', name: 'Sydney', kind: 'city', category: null, description: 'City', lon: 151.208, lat: -33.87, importance: 1, suburb: 'Sydney', state: 'NSW', postcode: '2000' },
    { id: 'ms1', name: 'Main Street', kind: 'street', category: null, description: '', lon: 149.231, lat: -35.352, importance: 0, suburb: 'Queanbeyan', state: 'NSW', postcode: '2620' },
    { id: 'ms2', name: 'Main Street', kind: 'street', category: null, description: '', lon: 148.9, lat: -35.0, importance: 0, suburb: 'Yass', state: 'NSW', postcode: '2582' },
  ] as places.PlaceInput[]);
}, 120_000);
afterAll(() => t?.close());

describe('place search', () => {
  it('finds the nearest branches of a chain with 400 stores elsewhere', async () => {
    const r = await places.searchPlaces(t.db, 'Woolworths', braddon, 5, friday);
    expect(r.slice(0, 2).map((p) => p.id)).toEqual(['w1', 'w2']);
    expect(r[0]).toMatchObject({ typeLabel: 'Supermarket', context: 'Dickson ACT 2602', description: 'Supermarket · Dickson ACT 2602' });
    expect(r[0]!.distanceM).toBeGreaterThan(1400);
    expect(r[0]!.distanceM).toBeLessThan(1600);
    expect(r[0]!.hours).toEqual({ openNow: true, label: 'Open until 10 pm' });
    expect(r[2]!.distanceM).toBeGreaterThan(190_000);
  });

  it('still finds a city by name from far away, above a nearby partial match', async () => {
    const r = await places.searchPlaces(t.db, 'Sydney', braddon, 5, friday);
    expect(r.map((p) => p.id).slice(0, 2)).toEqual(['syd', 's1']);
    expect(r[0]).toMatchObject({ typeLabel: 'City', context: 'NSW' });
  });

  it('ranks the Main Street next to the origin first and says which suburb it is in', async () => {
    const r = await places.searchPlaces(t.db, 'Main Street', queanbeyan, 5, friday);
    expect(r.map((p) => p.context)).toEqual(['Queanbeyan NSW 2620', 'Yass NSW 2582']);
  });

  it('lists the nearest places of a kind for category words, then name matches', async () => {
    const r = await places.searchPlaces(t.db, 'petrol', braddon, 5, friday);
    expect(r.map((p) => p.id).slice(0, 3)).toEqual(['f1', 'f2', 'c1']);
    expect(r[0]!.typeLabel).toBe('Fuel');
  });

  it('matches brands as well as names', async () => {
    const r = await places.searchPlaces(t.db, 'Ampol', braddon, 5, friday);
    expect(r.map((p) => p.id)).toEqual(expect.arrayContaining(['f1', 'f2']));
  });

  it('works without an origin (no distances)', async () => {
    const r = await places.searchPlaces(t.db, 'Sydney', null, 3, friday);
    expect(r[0]!.id).toBe('syd');
    expect(r[0]!.distanceM).toBeUndefined();
  });
});

describe('searchScore', () => {
  it('prefers the nearer of two equal text matches', () => {
    const base = { name: 'Woolworths', kind: 'poi', importance: 0.05, sim: 1 };
    const [nearLon, nearLat] = destination(braddon, 0, 2000);
    const [farLon, farLat] = destination(braddon, 0, 900_000);
    expect(places.searchScore({ ...base, lon: nearLon, lat: nearLat }, 'Woolworths', braddon)).toBeGreaterThan(
      places.searchScore({ ...base, lon: farLon, lat: farLat }, 'Woolworths', braddon),
    );
  });
});
