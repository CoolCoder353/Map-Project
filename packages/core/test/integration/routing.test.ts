import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, destination, haversineM, pathCells, cellToBigInt, parentCell } from '@wayfinder/shared';
import * as routing from '../../src/services/routing.js';
import * as places from '../../src/services/places.js';
import { MetricsAggregator } from '../../src/lib/metrics.js';
import type { GraphHopperClient, RouteParams } from '../../src/lib/graphhopper.js';
import { type TestDb, createTestDb } from '../helpers/db.js';
import { straightPath } from '../helpers/fakes.js';
import { makeUser } from '../helpers/users.js';

let t: TestDb;
const calls: RouteParams[] = [];
const SPEED = 15;
const fakeGh = {
  async route(p: RouteParams) {
    calls.push(p);
    return [straightPath(p.points, SPEED)];
  },
  async isochrone(point: LngLat, _profile: string, timeLimitS: number) {
    const r = timeLimitS * SPEED;
    return [Array.from({ length: 13 }, (_, i) => destination(point, i * 30, r))];
  },
  async health() {
    return { up: true, latencyMs: 1, detail: null };
  },
  async dataDate() {
    return null;
  },
} as unknown as GraphHopperClient;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

const deps = () => ({ db: t.db, graphhopper: fakeGh, metrics: new MetricsAggregator(async () => undefined) });

async function visit(userId: string, line: LngLat[]) {
  const cells = pathCells(line);
  await t.db.query(
    `INSERT INTO visited_cells (user_id, cell, r7, r5, first_visited_at, last_visited_at, modes)
     SELECT $1, c, r7, r5, now(), now(), 1 FROM unnest($2::bigint[], $3::bigint[], $4::bigint[]) AS t(c, r7, r5)
     ON CONFLICT DO NOTHING`,
    [userId, cells.map((c) => cellToBigInt(c).toString()), cells.map((c) => cellToBigInt(parentCell(c, 7)).toString()), cells.map((c) => cellToBigInt(parentCell(c, 5)).toString())],
  );
}

describe('routing service (fake GraphHopper)', () => {
  const from: LngLat = [149.0, -35.3];
  const to = destination(from, 90, 8000);

  it('fastest route reports novelty against the user history', async () => {
    const u = await makeUser(t.db, 'fast@example.com');
    const fresh = await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [] });
    expect(fresh.novelty.noveltyPct).toBeCloseTo(100, 0);
    await visit(u.id, [from, to]);
    const known = await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [] });
    expect(known.novelty.noveltyPct).toBeLessThan(10);
    expect(known.instructions.at(-1)!.sign).toBe(4);
  });

  it('explore routes detour through unexplored areas within the time budget', async () => {
    const u = await makeUser(t.db, 'explorer@example.com');
    await visit(u.id, [from, to]);
    calls.length = 0;
    const res = await routing.exploreRoutes(deps(), u.id, { from, to, mode: 'car', budgetMin: 10 });
    expect(res.fastest.novelty.newKm).toBeLessThan(1);
    expect(res.explore.length).toBeGreaterThan(0);
    for (const r of res.explore) {
      expect(r.durationS).toBeLessThanOrEqual(res.fastest.durationS + 600 + 1);
      expect(r.novelty.newKm).toBeGreaterThan(res.fastest.novelty.newKm);
      expect(r.extraDurationS).toBeGreaterThan(0);
      expect(r.viaPoints.length).toBeGreaterThan(0);
    }
    // custom models carry the visited area polygon
    const withModel = calls.filter((c) => c.customModel);
    expect(withModel.length).toBeGreaterThan(0);
    expect(withModel[0]!.customModel!.areas!.features[0]!.id).toBe('visited');
  });

  it('round trips return loops near the target duration', async () => {
    const u = await makeUser(t.db, 'looper@example.com');
    const loops = await routing.roundTrips(deps(), u.id, { start: from, mode: 'foot', targetMin: 60 });
    expect(loops.length).toBeGreaterThan(0);
    for (const l of loops) {
      expect(Math.abs(l.durationS - 3600)).toBeLessThanOrEqual(3600 * 0.2);
      expect(haversineM(l.geometry[0]!, l.geometry.at(-1)!)).toBeLessThan(5);
    }
  });

  it('discover suggests reachable POIs in unvisited cells', async () => {
    const u = await makeUser(t.db, 'discoverer@example.com');
    const near = destination(from, 45, 1500);
    const visitedPoi = destination(from, 180, 1000);
    const far = destination(from, 90, 200_000);
    await places.upsertPlaces(t.db, [
      { id: 'n1', name: 'Hidden Lookout', kind: 'poi', category: 'viewpoint', description: 'Lookout', lon: near[0], lat: near[1], importance: 0 },
      { id: 'n2', name: 'Known Park', kind: 'poi', category: 'park', description: 'Park', lon: visitedPoi[0], lat: visitedPoi[1], importance: 0 },
      { id: 'n3', name: 'Faraway Falls', kind: 'poi', category: 'waterfall', description: 'Waterfall', lon: far[0], lat: far[1], importance: 0 },
      { id: 'n4', name: 'Some Street', kind: 'street', category: null, description: '', lon: near[0], lat: near[1], importance: 0 },
    ]);
    await visit(u.id, [visitedPoi, destination(visitedPoi, 90, 10)]);
    const items = await routing.discover(deps(), u.id, { lon: from[0], lat: from[1], mode: 'car', maxMinutes: 10, limit: 10 });
    expect(items.map((i) => i.name)).toEqual(['Hidden Lookout']);
    expect(items[0]!.areaUnexploredPct).toBe(100);
    const parks = await routing.discover(deps(), u.id, { lon: from[0], lat: from[1], mode: 'car', maxMinutes: 10, limit: 10, categories: ['park'] });
    expect(parks).toHaveLength(0);
  });

  it('searches and reverse-geocodes places', async () => {
    await places.upsertPlaces(t.db, [
      { id: 'r1', name: 'Canberra', kind: 'city', category: null, description: 'Australian Capital Territory', lon: 149.13, lat: -35.28, importance: 1 },
      { id: 'r2', name: 'Canberra Avenue', kind: 'street', category: null, description: 'Griffith', lon: 149.14, lat: -35.32, importance: 0 },
      { id: 'r3', name: '12 Test Street', kind: 'address', category: null, description: 'Braddon', lon: 149.1301, lat: -35.2701, importance: 0 },
    ]);
    const results = await places.searchPlaces(t.db, 'canbera', [149.13, -35.28], 5);
    expect(results[0]!.name).toBe('Canberra');
    expect(results.map((r) => r.name)).toContain('Canberra Avenue');
    const rev = await places.reverseGeocode(t.db, [149.1302, -35.2702]);
    expect(rev?.name).toBe('12 Test Street');
    expect(await places.reverseGeocode(t.db, [120, -25])).toBeNull();
  });
});
