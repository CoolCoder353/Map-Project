import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, bearingDeg, destination, haversineM, pathCells, cellToBigInt, parentCell } from '@wayfinder/shared';
import * as routing from '../../src/services/routing.js';
import * as places from '../../src/services/places.js';
import { MetricsAggregator } from '../../src/lib/metrics.js';
import type { GhPath, GraphHopperClient, RouteParams } from '../../src/lib/graphhopper.js';
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

  it('passes on the speed limits along a route', async () => {
    const path = straightPath([from, to], SPEED);
    const last = path.points.coordinates.length - 1;
    path.details = { max_speed: [[0, 10, 60], [10, 11, null], [11, last, 80]] };
    const route = routing.toRoute(path, { kind: 'fastest', mode: 'car', novelty: { totalKm: 8, newKm: 8, noveltyPct: 100 } as never, extraDurationS: 0, viaPoints: [] });
    // The 100 m between points 10 and 11 has no limit mapped, so none is shown there.
    expect(route.speedLimits).toEqual([{ from: 0, to: 10, kmh: 60 }, { from: 11, to: last, kmh: 80 }]);
    // An engine that reported none: no limits rather than a guess.
    expect(routing.toRoute(straightPath([from, to], SPEED), { kind: 'fastest', mode: 'car', novelty: { totalKm: 8, newKm: 8, noveltyPct: 100 } as never, extraDurationS: 0, viaPoints: [] }).speedLimits).toEqual([]);
  });

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

  it('keeps via points on land: never routes through cells without roads (the sea)', async () => {
    // A coastline: streets only north of the trip; south of it is open water.
    const west: LngLat = [150.5, -33.0];
    const east = destination(west, 90, 20_000);
    const streets: places.PlaceInput[] = [];
    for (let i = 0; i <= 12; i++) {
      for (let j = 1; j <= 8; j++) {
        const [lon, lat] = destination(destination(west, 90, i * 2000), 0, j * 1500);
        streets.push({ id: `coast-${i}-${j}`, name: `Coast Road ${i}-${j}`, kind: 'street', category: null, description: '', lon, lat, importance: 0 });
      }
    }
    await places.upsertPlaces(t.db, streets);
    const onStreet = (p: LngLat) => streets.some((s) => Math.abs(s.lon - p[0]) < 1e-6 && Math.abs(s.lat - p[1]) < 1e-6);
    const u = await makeUser(t.db, 'coast@example.com');

    calls.length = 0;
    await routing.exploreRoutes(deps(), u.id, { from: west, to: east, mode: 'car', budgetMin: 30 });
    const exploreVias = calls.filter((c) => c.points.length > 2).flatMap((c) => c.points.slice(1, -1));
    expect(exploreVias.length).toBeGreaterThan(0);
    for (const v of exploreVias) {
      expect(onStreet(v), `via ${v} is not on a mapped street`).toBe(true);
      expect(v[1]).toBeGreaterThan(west[1]); // north of the coast
    }

    calls.length = 0;
    await routing.roundTrips(deps(), u.id, { start: west, mode: 'foot', targetMin: 60 });
    const loopVias = calls.flatMap((c) => c.points.slice(1, -1));
    expect(loopVias.length).toBeGreaterThan(0);
    // Loops stay on the land side; a turning point out at sea is dropped, not routed to.
    for (const v of loopVias) expect(v[1], `loop via ${v} is out at sea`).toBeGreaterThan(west[1]);
  });

  it('sends detours down through-roads, not service roads or dead ends', async () => {
    const base: LngLat = [151.5, -32.0];
    const east = destination(base, 90, 20_000);
    const rows: places.PlaceInput[] = [];
    for (let i = 0; i <= 12; i++) {
      for (let j = 1; j <= 8; j++) {
        const [lon, lat] = destination(destination(base, 90, i * 2000), 0, j * 1500);
        // A service road sits closest to each area centre, with a through road just beyond it.
        rows.push({ id: `svc-${i}-${j}`, name: `Back Lane ${i}-${j}`, kind: 'street', category: null, description: '', lon, lat, importance: 0, poiType: 'highway=service' });
        const [tlon, tlat] = destination([lon, lat], 0, 250);
        rows.push({ id: `thru-${i}-${j}`, name: `Main Way ${i}-${j}`, kind: 'street', category: null, description: '', lon: tlon, lat: tlat, importance: 0, poiType: 'highway=residential' });
      }
    }
    await places.upsertPlaces(t.db, rows);
    const u = await makeUser(t.db, 'throughroads@example.com');

    calls.length = 0;
    await routing.exploreRoutes(deps(), u.id, { from: base, to: east, mode: 'car', budgetMin: 30 });
    const vias = calls.filter((c) => c.points.length > 2).flatMap((c) => c.points.slice(1, -1));
    expect(vias.length).toBeGreaterThan(0);
    const through = new Set(rows.filter((r) => r.poiType === 'highway=residential').map((r) => `${r.lon},${r.lat}`));
    for (const v of vias) expect(through.has(`${v[0]},${v[1]}`), `via ${v} is not on a through road`).toBe(true);

    // Cars avoid tracks and service roads; walking keeps them.
    const carModel = calls.find((c) => c.customModel)?.customModel;
    expect(carModel?.priority?.some((p) => p.if === 'road_class == TRACK')).toBe(true);
    calls.length = 0;
    await routing.exploreRoutes(deps(), u.id, { from: base, to: east, mode: 'foot', budgetMin: 30 });
    for (const c of calls) expect(c.customModel?.priority?.some((p) => p.if === 'road_class == TRACK') ?? false).toBe(false);
  });

  it('still offers loops where almost no roads are mapped', async () => {
    const outback: LngLat = [141.5, -25.0];
    await places.upsertPlaces(t.db, [
      { id: 'outback-street', name: 'Lonely Road', kind: 'street', category: null, description: '', lon: 141.6, lat: -25.2, importance: 0 },
    ]);
    const u = await makeUser(t.db, 'outback@example.com');
    const loops = await routing.roundTrips(deps(), u.id, { start: outback, mode: 'foot', targetMin: 60 });
    expect(loops.length).toBeGreaterThan(0);
  });

  describe('U-turns on detours', () => {
    // Every mapped street is a dead end 300 m off the road from the south, as courts and closes
    // are: a route through one dips in, turns around at the via and comes back out.
    const base: LngLat = [152.5, -31.0];
    const east = destination(base, 90, 20_000);
    const streets: places.PlaceInput[] = [];
    for (let i = 0; i <= 12; i++) {
      for (let j = -3; j <= 6; j++) {
        const [lon, lat] = destination(destination(base, 90, i * 2000), 0, j * 1500);
        streets.push({ id: `court-${i}-${j}`, name: `Quiet Court ${i}-${j}`, kind: 'street', category: null, description: '', lon, lat, importance: 0 });
      }
    }
    const isCourt = (p: LngLat) => streets.some((s) => Math.abs(s.lon - p[0]) < 1e-9 && Math.abs(s.lat - p[1]) < 1e-9);
    const isUTurn = (sign: number) => sign === -98 || Math.abs(sign) === 8;
    const ghCalls: RouteParams[] = [];

    /** Where the fake routes turned off the road into a dead end: the middle of the stretch before. */
    const turnOffs: LngLat[] = [];

    /** A route with a dip into each dead-end via, and a U-turn instruction at the end of each. */
    function withDeadEnds(points: LngLat[], turnAroundAt: (via: LngLat) => boolean): GhPath {
      const legs: LngLat[] = [points[0]!];
      const deadEnds: Array<{ via: LngLat; junction: LngLat }> = [];
      for (const p of points.slice(1, -1)) {
        if (turnAroundAt(p)) {
          // The dead end runs off at right angles to the way the route was heading.
          const junction = destination(p, bearingDeg(legs.at(-1)!, p) + 90, 300);
          legs.push(junction, p, junction);
          deadEnds.push({ via: p, junction });
        } else legs.push(p);
      }
      legs.push(points.at(-1)!);
      const path = straightPath(legs, SPEED);
      const coords = path.points.coordinates;
      const uTurns = deadEnds.map(({ via, junction }) => {
        const at = coords.findIndex((c) => haversineM(c, via) < 1);
        const j = coords.findLastIndex((c, k) => k < at && haversineM(c, junction) < 1);
        turnOffs.push([(coords[j - 1]![0] + coords[j]![0]) / 2, (coords[j - 1]![1] + coords[j]![1]) / 2]);
        return at;
      });
      path.instructions.splice(
        1,
        0,
        ...uTurns.map((i) => ({ distance: 300, sign: -98, interval: [i, i] as [number, number], text: 'Make a U-turn', time: 20_000 })),
      );
      return path;
    }
    const ghWith = (turnAroundAt: (via: LngLat) => boolean) =>
      ({
        ...fakeGh,
        async route(p: RouteParams) {
          ghCalls.push(p);
          return [withDeadEnds(p.points, turnAroundAt)];
        },
      }) as unknown as GraphHopperClient;

    beforeAll(async () => {
      await places.upsertPlaces(t.db, streets);
    });

    it('asks again with the via moved onto the road it turned off, and offers the route without the U-turn', async () => {
      const u = await makeUser(t.db, 'deadends@example.com');
      ghCalls.length = 0;
      const res = await routing.exploreRoutes({ ...deps(), graphhopper: ghWith(isCourt) }, u.id, { from: base, to: east, mode: 'car', budgetMin: 30 });
      expect(res.explore.length).toBeGreaterThan(0);
      for (const r of res.explore) {
        expect(r.instructions.some((i) => isUTurn(i.sign))).toBe(false);
        for (const v of r.viaPoints) expect(isCourt(v), `via ${v} is still the dead end`).toBe(false);
      }
      // The moved via sits on the road the route came along, just before it turned off into the dip.
      const retried = ghCalls.filter((c) => c.points.slice(1, -1).some((v) => !isCourt(v)));
      expect(retried.length).toBeGreaterThan(0);
      for (const c of retried) {
        for (const v of c.points.slice(1, -1).filter((p) => !isCourt(p))) {
          expect(Math.min(...turnOffs.map((o) => haversineM(o, v))), `via ${v} is not where the route turned off`).toBeLessThan(1);
        }
      }
    });

    it('never offers a driving detour or loop that needs a U-turn, however often it asks again', async () => {
      const u = await makeUser(t.db, 'alwaysuturn@example.com');
      ghCalls.length = 0;
      const always = { ...deps(), graphhopper: ghWith(() => true) };
      const res = await routing.exploreRoutes(always, u.id, { from: base, to: east, mode: 'car', budgetMin: 30 });
      for (const r of res.explore) expect(r.instructions.some((i) => isUTurn(i.sign))).toBe(false);
      const viaRequests = ghCalls.filter((c) => c.points.length > 2);
      // The first try and at most two more for each detour.
      expect(viaRequests.length).toBeLessThanOrEqual(3 * viaRequests.filter((c) => c.points.slice(1, -1).every(isCourt)).length);

      const loops = await routing.roundTrips(always, u.id, { start: base, mode: 'car', targetMin: 30 });
      for (const l of loops) expect(l.instructions.some((i) => isUTurn(i.sign))).toBe(false);
      // On foot, turning round is fine: a walk with one is still offered.
      const walks = await routing.exploreRoutes(always, u.id, { from: base, to: east, mode: 'foot', budgetMin: 60 });
      expect(walks.explore.some((r) => r.instructions.filter((i) => isUTurn(i.sign)).length === 1)).toBe(true);
    });
  });
});
