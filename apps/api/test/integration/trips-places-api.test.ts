import { randomUUID } from 'node:crypto';
import { placeService, savedPlaceService, trackService } from '@wayfinder/core';
import { MAX_SAVED_PLACES, destination } from '@wayfinder/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp, makeUser, tokenFor } from '../helpers/app.js';

let ta: TestApp;
let auth: { authorization: string };
let other: { authorization: string };

beforeAll(async () => {
  ta = await createTestApp();
  const u = await makeUser(ta.t.db, 'trips@example.com');
  auth = { authorization: await tokenFor(ta, u, 'user') };
  other = { authorization: await tokenFor(ta, await makeUser(ta.t.db, 'other@example.com'), 'user') };
  await placeService.upsertPlaces(ta.t.db, [
    { id: 'n1', name: 'Gumdale State School', kind: 'poi', category: null, description: 'School', lon: 153.155, lat: -27.49, importance: 0.1, suburb: 'Gumdale', state: 'QLD', postcode: '4154', poiType: 'amenity=school' },
    { id: 'n2', name: 'Gumdale', kind: 'suburb', category: null, description: 'Suburb', lon: 153.15, lat: -27.49, importance: 0.3, suburb: 'Gumdale', state: 'QLD' },
  ]);
});
afterAll(() => ta?.close());

let tripsRecorded = 0;
/** A new trip each time, hours apart: the same moments uploaded again would be the same trip. */
async function recordTrip() {
  const start = Date.now() - (3 + 2 * tripsRecorded++) * 3600_000;
  const points = Array.from({ length: 200 }, (_, i) => {
    const [lon, lat] = destination([153.1, -27.5], 0, i * 7);
    return { ts: start + i * 5000, lon, lat, accuracyM: 6 };
  });
  const up = await ta.app.inject({ method: 'POST', url: '/api/tracks/batches', headers: auth, payload: { batchId: randomUUID(), source: 'background', points } });
  expect(up.statusCode).toBe(202);
  for (const j of ta.queue.take('process-tracks')) await trackService.processUserTracks(ta.t.db, j.data.userId as string);
  return (await ta.app.inject({ method: 'GET', url: '/api/trips', headers: auth })).json().items[0].id as string;
}

describe('trips over HTTP', () => {
  it('rejects a malformed upload', async () => {
    const bad = await ta.app.inject({ method: 'POST', url: '/api/tracks/batches', headers: auth, payload: { batchId: 'not-a-uuid', source: 'background', points: [] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');
  });

  it('corrects a trip’s mode and queues a coverage rebuild; only for the owner', async () => {
    const id = await recordTrip();
    ta.queue.take('rebuild-coverage');
    expect((await ta.app.inject({ method: 'PATCH', url: `/api/trips/${id}`, headers: auth, payload: { mode: 'boat' } })).statusCode).toBe(400);
    expect((await ta.app.inject({ method: 'PATCH', url: `/api/trips/${id}`, headers: other, payload: { mode: 'foot' } })).statusCode).toBe(404);
    const ok = await ta.app.inject({ method: 'PATCH', url: `/api/trips/${id}`, headers: auth, payload: { mode: 'foot' } });
    expect(ok.json()).toEqual({ ok: true });
    expect((await ta.app.inject({ method: 'GET', url: `/api/trips/${id}`, headers: auth })).json().mode).toBe('foot');
    expect(ta.queue.take('rebuild-coverage')).toHaveLength(1);
  });

  it('deletes a trip for its owner only; it leaves the list', async () => {
    const id = await recordTrip();
    expect((await ta.app.inject({ method: 'DELETE', url: `/api/trips/${id}`, headers: other })).statusCode).toBe(404);
    expect((await ta.app.inject({ method: 'DELETE', url: `/api/trips/${id}`, headers: auth })).json()).toEqual({ ok: true });
    const list = (await ta.app.inject({ method: 'GET', url: '/api/trips', headers: auth })).json();
    expect(list.items.map((t: { id: string }) => t.id)).not.toContain(id);
    expect((await ta.app.inject({ method: 'GET', url: `/api/trips/${id}`, headers: auth })).statusCode).toBe(404);
  });

  it('pages trips with a cursor', async () => {
    const page = await ta.app.inject({ method: 'GET', url: '/api/trips?limit=1', headers: auth });
    expect(page.json().items).toHaveLength(1);
    expect((await ta.app.inject({ method: 'GET', url: '/api/trips?limit=0', headers: auth })).statusCode).toBe(400);
  });
});

describe('search over HTTP', () => {
  it('finds places by name, nearest first when given a position', async () => {
    const res = await ta.app.inject({ method: 'GET', url: '/api/search?q=gumdale%20state&lon=153.15&lat=-27.49&limit=5', headers: auth });
    expect(res.statusCode).toBe(200);
    const [first] = res.json().results;
    expect(first).toMatchObject({ name: 'Gumdale State School', location: [153.155, -27.49] });
    expect(first.distanceM).toBeGreaterThan(0);
    const noPos = (await ta.app.inject({ method: 'GET', url: '/api/search?q=gumdale', headers: auth })).json().results;
    expect(noPos.every((p: { distanceM?: number }) => p.distanceM === undefined)).toBe(true);
  });

  it('validates the query and needs a session', async () => {
    expect((await ta.app.inject({ method: 'GET', url: '/api/search?q=', headers: auth })).statusCode).toBe(400);
    expect((await ta.app.inject({ method: 'GET', url: '/api/search?q=gum&lat=100&lon=0', headers: auth })).statusCode).toBe(400);
    expect((await ta.app.inject({ method: 'GET', url: '/api/search?q=gum' })).statusCode).toBe(401);
  });

  it('names a point on the map', async () => {
    const res = await ta.app.inject({ method: 'GET', url: '/api/reverse?lon=153.1551&lat=-27.4901', headers: auth });
    expect(res.json().place).toMatchObject({ name: 'Gumdale State School' });
    const nowhere = await ta.app.inject({ method: 'GET', url: '/api/reverse?lon=120&lat=-20', headers: auth });
    expect(nowhere.json()).toEqual({ place: null });
    expect((await ta.app.inject({ method: 'GET', url: '/api/reverse?lon=200&lat=0', headers: auth })).statusCode).toBe(400);
  });

  it('keeps planned routes per person, and validates them', async () => {
    expect((await ta.app.inject({ method: 'POST', url: '/api/planned-routes', headers: auth, payload: { name: '', route: {} } })).statusCode).toBe(400);
    const fastest = (await ta.app.inject({ method: 'POST', url: '/api/routes/fastest', headers: auth, payload: { from: [153.1, -27.5], to: [153.2, -27.5], mode: 'car' } })).json();
    const saved = (await ta.app.inject({ method: 'POST', url: '/api/planned-routes', headers: auth, payload: { name: 'Mine', route: fastest } })).json();
    expect((await ta.app.inject({ method: 'GET', url: '/api/planned-routes', headers: other })).json().items).toEqual([]);
    await ta.app.inject({ method: 'DELETE', url: `/api/planned-routes/${saved.id}`, headers: other });
    expect((await ta.app.inject({ method: 'GET', url: '/api/planned-routes', headers: auth })).json().items).toHaveLength(1);
  });
});

describe('saved places over HTTP', () => {
  const home = { name: 'Home', description: '27 Whitby Place, Thornlands', location: [153.26, -27.56] };

  it('saves places under your own names and offers them first when a search starts with one', async () => {
    const saved = await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: auth, payload: home });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ name: 'Home', description: '27 Whitby Place, Thornlands', location: [153.26, -27.56] });
    // "ho" is enough, and it comes before every other place.
    await placeService.upsertPlaces(ta.t.db, [
      { id: 'n3', name: 'Home Hill', kind: 'town', category: null, description: 'Town', lon: 147.41, lat: -19.66, importance: 0.4, suburb: null, state: 'QLD' },
    ]);
    const found = (await ta.app.inject({ method: 'GET', url: '/api/search?q=ho&lon=153.25&lat=-27.56', headers: auth })).json();
    expect(found.results[0]).toMatchObject({ id: `saved:${saved.json().id}`, name: 'Home', kind: 'saved', typeLabel: 'Saved place', context: '27 Whitby Place, Thornlands', location: [153.26, -27.56] });
    expect(found.results[0].distanceM).toBeGreaterThan(900);
    expect(found.results[0].distanceM).toBeLessThan(1100);
    expect(found.results.map((r: { name: string }) => r.name)).toContain('Home Hill');
    // Nobody else's Home.
    const theirs = (await ta.app.inject({ method: 'GET', url: '/api/search?q=home', headers: other })).json();
    expect(theirs.results.map((r: { kind: string }) => r.kind)).not.toContain('saved');
    // Nothing saved matches "gum".
    expect((await ta.app.inject({ method: 'GET', url: '/api/search?q=gum', headers: auth })).json().results[0].kind).not.toBe('saved');
  });

  it('moves a place saved again under the same name, lists and deletes them for their owner only', async () => {
    const work = (await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: auth, payload: { name: 'Work', location: [153.03, -27.47] } })).json();
    const moved = (await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: auth, payload: { ...home, name: 'home', location: [153.27, -27.57] } })).json();
    const list = (await ta.app.inject({ method: 'GET', url: '/api/saved-places', headers: auth })).json();
    expect(list.items.map((p: { name: string; location: number[] }) => [p.name, p.location])).toEqual([['home', [153.27, -27.57]], ['Work', [153.03, -27.47]]]);
    expect(list.items[0].id).toBe(moved.id);
    expect(list.items[1].description).toBe('');
    expect((await ta.app.inject({ method: 'GET', url: '/api/saved-places', headers: other })).json().items).toEqual([]);
    expect((await ta.app.inject({ method: 'DELETE', url: `/api/saved-places/${work.id}`, headers: other })).statusCode).toBe(404);
    expect((await ta.app.inject({ method: 'DELETE', url: `/api/saved-places/${work.id}`, headers: auth })).json()).toEqual({ ok: true });
    expect((await ta.app.inject({ method: 'DELETE', url: '/api/saved-places/not-an-id', headers: auth })).statusCode).toBe(404);
    // Downloaded with the rest of your data.
    const exported = (await ta.app.inject({ method: 'GET', url: '/api/me/export', headers: auth })).json();
    expect(exported.savedPlaces.map((p: { name: string }) => p.name)).toEqual(['home']);
  });

  it('validates what is saved, and stops at the limit', async () => {
    expect((await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: auth, payload: { name: ' ', location: [153, -27] } })).statusCode).toBe(400);
    expect((await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: auth, payload: { name: 'Gym', location: [200, -27] } })).statusCode).toBe(400);
    const u = await makeUser(ta.t.db, 'collector@example.com');
    const many = { authorization: await tokenFor(ta, u, 'user') };
    for (let i = 0; i < MAX_SAVED_PLACES; i++) await savedPlaceService.saveSavedPlace(ta.t.db, u.id, { name: `Place ${i}`, description: '', location: [153, -27] });
    const over = await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: many, payload: { name: 'One more', location: [153, -27] } });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.message).toMatch(/up to 50 places/);
    // Moving one already saved is still fine.
    expect((await ta.app.inject({ method: 'POST', url: '/api/saved-places', headers: many, payload: { name: 'place 3', location: [153.1, -27] } })).statusCode).toBe(200);
  });
});

describe('explore budget', () => {
  it('accepts a request without a budget, falling back to the saved one', async () => {
    await ta.t.db.query(`UPDATE users SET settings = settings || '{"exploreBudgetMin": 40}' WHERE email = 'trips@example.com'`);
    const token = { authorization: await tokenFor(ta, (await ta.t.db.query("SELECT id, email FROM users WHERE email = 'trips@example.com'")).rows[0], 'user') };
    const res = await ta.app.inject({ method: 'POST', url: '/api/routes/explore', headers: token, payload: { from: [153.1, -27.5], to: [153.2, -27.5], mode: 'car' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().fastest).toBeTruthy();
  });
});
