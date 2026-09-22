import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trackService } from '@wayfinder/core';
import { destination } from '@wayfinder/shared';
import { type TestApp, createTestApp, makeUser, tokenFor } from '../helpers/app.js';

let ta: TestApp;
let auth: { authorization: string };
let user: { id: string };

beforeAll(async () => {
  ta = await createTestApp();
  user = await makeUser(ta.t.db, 'app@example.com');
  auth = { authorization: await tokenFor(ta, user, 'user') };
});
afterAll(async () => {
  await ta?.close();
});

describe('app API', () => {
  it('uploads tracks, processes them and serves trips + coverage', async () => {
    const start = Date.now() - 3 * 3600_000;
    const points = Array.from({ length: 300 }, (_, i) => {
      const [lon, lat] = destination([149.1, -35.3], 0, i * 7);
      return { ts: start + i * 5000, lon, lat, accuracyM: 6 };
    });
    const batch = { batchId: randomUUID(), source: 'background', points };
    const up = await ta.app.inject({ method: 'POST', url: '/api/tracks/batches', headers: auth, payload: batch });
    expect(up.statusCode).toBe(202);
    const dup = await ta.app.inject({ method: 'POST', url: '/api/tracks/batches', headers: auth, payload: batch });
    expect(dup.json()).toEqual({ accepted: 0, duplicate: true });
    for (const j of ta.queue.take('process-tracks')) await trackService.processUserTracks(ta.t.db, j.data.userId as string);

    const trips = (await ta.app.inject({ method: 'GET', url: '/api/trips', headers: auth })).json();
    expect(trips.items).toHaveLength(1);
    const detail = await ta.app.inject({ method: 'GET', url: `/api/trips/${trips.items[0].id}`, headers: auth });
    expect(detail.json().points).toHaveLength(300);
    const other = await makeUser(ta.t.db, 'nosy@example.com');
    const nosy = await ta.app.inject({ method: 'GET', url: `/api/trips/${trips.items[0].id}`, headers: { authorization: await tokenFor(ta, other, 'user') } });
    expect(nosy.statusCode).toBe(404);

    const cov = await ta.app.inject({ method: 'GET', url: '/api/coverage?bbox=149.05,-35.35,149.15,-35.25&zoom=14', headers: auth });
    expect(cov.statusCode).toBe(200);
    // Coverage is the roads travelled; this trip was not map-matched in the test stack, so the
    // view is empty but well-formed.
    expect(Array.isArray(cov.json().roads)).toBe(true);
    const geo = (await ta.app.inject({ method: 'GET', url: '/api/coverage?bbox=149.05,-35.35,149.15,-35.25&zoom=14&format=geojson', headers: auth })).json();
    expect(geo.type).toBe('FeatureCollection');
    const stats = (await ta.app.inject({ method: 'GET', url: '/api/coverage/stats', headers: auth })).json();
    expect(stats.tripCount).toBe(1);
    const badBbox = await ta.app.inject({ method: 'GET', url: '/api/coverage?bbox=1,2&zoom=14', headers: auth });
    expect(badBbox.statusCode).toBe(400);
  });

  it('routes: fastest, explore, round trip, discover; planned routes CRUD', async () => {
    const from = [149.1, -35.3];
    const to = [149.2, -35.3];
    const fastest = await ta.app.inject({ method: 'POST', url: '/api/routes/fastest', headers: auth, payload: { from, to, mode: 'car' } });
    expect(fastest.statusCode).toBe(200);
    expect(fastest.json().kind).toBe('fastest');
    const explore = await ta.app.inject({ method: 'POST', url: '/api/routes/explore', headers: auth, payload: { from, to, mode: 'car', budgetMin: 10 } });
    expect(explore.statusCode).toBe(200);
    expect(explore.json().fastest).toBeTruthy();
    const loop = await ta.app.inject({ method: 'POST', url: '/api/routes/roundtrip', headers: auth, payload: { start: from, mode: 'foot', targetMin: 45 } });
    expect(loop.statusCode).toBe(200);
    expect(Array.isArray(loop.json().routes)).toBe(true);
    const disc = await ta.app.inject({ method: 'GET', url: '/api/discover?lon=149.1&lat=-35.3&mode=foot&maxMinutes=20', headers: auth });
    expect(disc.statusCode).toBe(200);

    const saved = await ta.app.inject({ method: 'POST', url: '/api/planned-routes', headers: auth, payload: { name: 'Sunday loop', route: fastest.json() } });
    expect(saved.statusCode).toBe(201);
    const list = (await ta.app.inject({ method: 'GET', url: '/api/planned-routes', headers: auth })).json();
    expect(list.items.map((i: { name: string }) => i.name)).toEqual(['Sunday loop']);
    const del = await ta.app.inject({ method: 'DELETE', url: `/api/planned-routes/${saved.json().id}`, headers: auth });
    expect(del.statusCode).toBe(200);
  });

  it('records metrics per route template and error events for unexpected failures', async () => {
    ta.ghDown.value = true;
    const res = await ta.app.inject({ method: 'POST', url: '/api/routes/fastest', headers: auth, payload: { from: [149.1, -35.3], to: [149.2, -35.3], mode: 'car' } });
    ta.ghDown.value = false;
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toBe('Something went wrong');
    const errors = (await ta.t.db.query('SELECT service, source, message FROM error_events')).rows;
    expect(errors).toContainEqual({ service: 'api', source: 'POST /api/routes/fastest', message: 'boom: engine exploded' });

    await ta.metrics.flush(true);
    const rows = (await ta.t.db.query("SELECT label, sum(count)::int AS n, sum(error_count)::int AS e FROM metrics_minute WHERE metric = 'http.request' GROUP BY label")).rows;
    const tripDetail = rows.find((r) => r.label === 'GET /api/trips/:id');
    expect(tripDetail?.n).toBeGreaterThanOrEqual(2);
    expect(rows.find((r) => r.label === 'POST /api/routes/fastest')?.e).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => !/[0-9a-f]{8}-[0-9a-f]{4}/.test(r.label))).toBe(true);

    const adminUser = await makeUser(ta.t.db, 'ops@example.com', 'admin');
    const errs = (await ta.app.inject({ method: 'GET', url: '/api/admin/errors', headers: { authorization: await tokenFor(ta, adminUser, 'admin') } })).json();
    expect(errs.groups[0].count).toBeGreaterThanOrEqual(1);
  });

  it('health endpoints report routing engine status', async () => {
    const pub = await ta.app.inject({ method: 'GET', url: '/api/health' });
    expect(pub.json()).toEqual({ status: 'ok', database: true, routing: true });
    ta.ghDown.value = true;
    const adminUser = await makeUser(ta.t.db, 'ops2@example.com', 'admin');
    const h = (await ta.app.inject({ method: 'GET', url: '/api/admin/health', headers: { authorization: await tokenFor(ta, adminUser, 'admin') } })).json();
    ta.ghDown.value = false;
    expect(h.services.find((s: { name: string }) => s.name === 'graphhopper').up).toBe(false);
    expect(h.services.find((s: { name: string }) => s.name === 'worker').up).toBe(false);
  });

  it('serves the map style with absolute URLs and 404 for tiles before they are built', async () => {
    const style = await ta.app.inject({ method: 'GET', url: '/map/style.json?theme=dark', headers: { host: 'maps.test' } });
    expect(style.statusCode).toBe(200);
    expect(style.json().sources.openmaptiles.url).toBe('http://maps.test/tiles/tiles.json');
    expect((await ta.app.inject({ method: 'GET', url: '/tiles/1/0/0.mvt' })).statusCode).toBe(404);
    expect((await ta.app.inject({ method: 'GET', url: '/tiles/tiles.json' })).json().error.code).toBe('tiles_not_built');
  });
});
