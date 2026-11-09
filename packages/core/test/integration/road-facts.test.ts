import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
import * as routing from '../../src/services/routing.js';
import * as roads from '../../src/services/roads.js';
import * as speeds from '../../src/services/road-speeds.js';
import * as lightTiming from '../../src/services/light-timing.js';
import { MetricsAggregator } from '../../src/lib/metrics.js';
import type { GhPath, GraphHopperClient, RouteParams } from '../../src/lib/graphhopper.js';
import { type TestDb, createTestDb } from '../helpers/db.js';
import { straightPath } from '../helpers/fakes.js';
import { makeUser } from '../helpers/users.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

const from: LngLat = [153.05, -27.45];
const to = destination(from, 90, 3000);
const SPEED = 12.5;

/** The fastest path, on way 501, and a longer one north of it on way 502. */
const direct = (): GhPath => {
  const p = straightPath([from, to], SPEED);
  p.details = { osm_way_id: [[0, p.points.coordinates.length - 1, 501]] };
  return p;
};
const around = (): GhPath => {
  const p = straightPath([from, destination(destination(from, 90, 1500), 0, 400), to], SPEED);
  p.details = { osm_way_id: [[0, p.points.coordinates.length - 1, 502]] };
  return p;
};

const calls: RouteParams[] = [];
const gh = {
  async route(p: RouteParams) {
    calls.push(p);
    return p.alternatives ? [direct(), around()] : [direct()];
  },
} as unknown as GraphHopperClient;
const deps = () => ({ db: t.db, graphhopper: gh, metrics: new MetricsAggregator(async () => undefined) });

describe('routes and what the map knows about their roads', () => {
  it('finds the lights on a route from the table and allows for them', async () => {
    const u = await makeUser(t.db, 'lights@example.com');
    const light = destination(from, 90, 1000);
    await t.db.query(`INSERT INTO traffic_signals (id, lon, lat, kind) VALUES (1, $1, $2, 'signals'), (2, 150, -30, 'signals')`, light);
    const route = await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [] });
    expect(route.trafficSignals).toEqual([{ index: 10, kind: 'signals', id: '1' }]);
    expect(route.durationS).toBeCloseTo(3000 / SPEED + 15, 0);
    // Walking, lights don't count.
    expect((await routing.fastestRoute(deps(), u.id, { from, to, mode: 'foot', via: [] })).trafficSignals).toBeUndefined();
    await t.db.query('DELETE FROM traffic_signals');
  });

  it('drops the limit on roads with electronic signs', async () => {
    const u = await makeUser(t.db, 'signs@example.com');
    const path = direct();
    path.details!.max_speed = [[0, path.points.coordinates.length - 1, 100]];
    const once = { async route() { return [path]; } } as unknown as GraphHopperClient;
    await t.db.query(`INSERT INTO way_speed_rules (way_id, variable) VALUES (501, true)`);
    const route = await routing.fastestRoute({ ...deps(), graphhopper: once }, u.id, { from, to, mode: 'car', via: [] });
    expect(route.speedLimits).toEqual([]);
    await t.db.query('DELETE FROM way_speed_rules');
  });

  it('when the fastest route is usually slow, takes another way that really is quicker', async () => {
    const u = await makeUser(t.db, 'slow@example.com');
    // Trips crawl along way 501 at 10 km/h, whatever the hour.
    await t.db.query(`INSERT INTO road_speeds (way_id, day_kind, hour, kmh, trips) VALUES (501, 0, 24, 10, 5), (501, 1, 24, 10, 5)`);
    calls.length = 0;
    const route = await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [] });
    expect(calls.at(-1)).toMatchObject({ alternatives: 3 });
    expect(route.geometry).toEqual(around().points.coordinates);
    expect(route.usuallySlow).toBeUndefined();
    // A new route asked for on the move keeps the way it's going.
    expect((await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [], heading: 90 })).usuallySlow).toBe(true);
    await t.db.query('DELETE FROM road_speeds');
  });

  it('applies to detours and their extra time', async () => {
    const u = await makeUser(t.db, 'explore-lights@example.com');
    const res = await routing.exploreRoutes(deps(), u.id, { from, to, mode: 'car', budgetMin: 20 });
    for (const r of res.explore) expect(r.extraDurationS).toBeCloseTo(Math.max(0, r.durationS - res.fastest.durationS));
  });
});

describe('road speeds learned from drives', () => {
  const start = Date.parse('2026-11-02T08:00:00+10:00'); // a Monday, 8 am in Brisbane
  /** A 2 km drive east at 10 m/s, matched to three roads. */
  async function driveTrip(userId: string, dayOffset: number) {
    const t0 = start + dayOffset * 86_400_000;
    const trip = await t.db.query<{ id: string }>(
      `INSERT INTO trips (user_id, mode, source, started_at, ended_at) VALUES ($1, 'car', 'background', $2, $3) RETURNING id`,
      [userId, new Date(t0), new Date(t0 + 200_000)],
    );
    const id = trip.rows[0]!.id;
    const fixes = Array.from({ length: 101 }, (_, i) => ({ p: destination(from, 90, i * 20), ts: t0 + i * 2000 }));
    await t.db.query(
      `INSERT INTO track_points (user_id, trip_id, batch_id, source, mode, ts, lon, lat)
       SELECT $1, $2, gen_random_uuid(), 'background', 'car', ts, lon, lat FROM unnest($3::timestamptz[], $4::float8[], $5::float8[]) AS x(ts, lon, lat)`,
      [userId, id, fixes.map((f) => new Date(f.ts)), fixes.map((f) => f.p[0]), fixes.map((f) => f.p[1])],
    );
    return id;
  }
  const matcher = {
    async match(points: ReadonlyArray<{ lon: number; lat: number }>) {
      const coordinates = points.map((p) => [p.lon, p.lat] as LngLat);
      const n = coordinates.length - 1;
      return { distance: 2000, time: 0, points: { type: 'LineString' as const, coordinates }, instructions: [], details: { osm_way_id: [[0, 25, 701], [25, 75, 702], [75, n, 703]] } };
    },
  };

  it('keeps the median speed of each road where enough trips from enough people agree, by hour and for the day', async () => {
    const u = await makeUser(t.db, 'commuter@example.com');
    for (const day of [0, 1, 2, 3]) await driveTrip(u.id, day);
    await roads.matchTrips(t.db, matcher as never, u.id);
    const samples = await t.db.query<{ way_id: string; hour: number; kmh: number }>('SELECT way_id::text, hour, kmh FROM road_speed_samples ORDER BY id');
    expect(samples.rows.map((r) => [r.way_id, r.hour])).toEqual([['702', 8], ['702', 8], ['702', 8], ['702', 8]]);
    expect(samples.rows[0]!.kmh).toBeCloseTo(36, 0);

    // However many trips one person makes, they alone don't set a road's speed for everyone.
    expect(await speeds.rebuildRoadSpeeds(t.db)).toMatchObject({ roads: 0 });
    const other = await makeUser(t.db, 'neighbour@example.com');
    await driveTrip(other.id, 2);
    await roads.matchTrips(t.db, matcher as never, other.id);
    expect(await speeds.rebuildRoadSpeeds(t.db)).toMatchObject({ roads: 1 });
    const rows = (await t.db.query<{ hour: number; trips: number }>('SELECT hour, trips FROM road_speeds WHERE way_id = 702 ORDER BY hour')).rows;
    expect(rows).toEqual([{ hour: 8, trips: 5 }, { hour: 24, trips: 5 }]);

    // A weekday at 8 uses that hour; at 3 pm the whole day's.
    const at8 = await speeds.learnedSpeeds(t.db, [701, 702], new Date('2026-11-09T08:30:00+10:00'), from);
    expect([...at8.keys()]).toEqual([702]);
    expect(at8.get(702)).toBeCloseTo(36, 0);
    await t.db.query('UPDATE road_speeds SET kmh = 20 WHERE hour = 24');
    expect((await speeds.learnedSpeeds(t.db, [702], new Date('2026-11-09T15:00:00+10:00'), from)).get(702)).toBe(20);
    // None at the weekend.
    expect((await speeds.learnedSpeeds(t.db, [702], new Date('2026-11-07T08:30:00+10:00'), from)).size).toBe(0);
    expect((await speeds.learnedSpeeds(t.db, [], new Date(), from)).size).toBe(0);
  });

  it('goes only by drives that still stand', async () => {
    const neighbour = `(SELECT id FROM users WHERE email = 'neighbour@example.com')`;
    const rebuilt = async () => (await speeds.rebuildRoadSpeeds(t.db)).roads;
    expect(await rebuilt()).toBe(1);
    // The second person's trip deleted, marked as a walk, or their account deleted or disabled: one person is left.
    await t.db.query(`UPDATE trips SET deleted_at = now() WHERE user_id = ${neighbour}`);
    expect(await rebuilt()).toBe(0);
    await t.db.query(`UPDATE trips SET deleted_at = NULL, mode = 'foot' WHERE user_id = ${neighbour}`);
    expect(await rebuilt()).toBe(0);
    await t.db.query(`UPDATE trips SET mode = 'car' WHERE user_id = ${neighbour}`);
    expect(await rebuilt()).toBe(1);
    await t.db.query(`UPDATE users SET deleted_at = now() WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(0);
    await t.db.query(`UPDATE users SET deleted_at = NULL, disabled_at = now() WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(0);
    await t.db.query(`UPDATE users SET disabled_at = NULL WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(1);
    // A test account's drives (an admin's second account, the device harness) don't count either.
    await t.db.query(`UPDATE users SET test_account = true WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(0);
    await t.db.query(`UPDATE users SET test_account = false WHERE id = ${neighbour}`);
    expect(await rebuilt()).toBe(1);
  });

  it('forgets old drives, and a deleted trip’s', async () => {
    await t.db.query(`UPDATE road_speed_samples SET observed_at = now() - interval '200 days' WHERE trip_id IN (SELECT id FROM trips WHERE user_id = (SELECT id FROM users WHERE email = 'neighbour@example.com'))`);
    expect(await speeds.rebuildRoadSpeeds(t.db)).toEqual({ roads: 0, pruned: 1 });
    await t.db.query('DELETE FROM trips');
    expect(Number((await t.db.query<{ n: string }>('SELECT count(*) AS n FROM road_speed_samples')).rows[0]!.n)).toBe(0);
  });

  it('records nothing for walks', async () => {
    const u = await makeUser(t.db, 'walker@example.com');
    const id = await driveTrip(u.id, 0);
    await t.db.query(`UPDATE trips SET mode = 'foot' WHERE id = $1`, [id]);
    await roads.matchTrips(t.db, matcher as never, u.id);
    expect(Number((await t.db.query<{ n: string }>('SELECT count(*) AS n FROM road_speed_samples')).rows[0]!.n)).toBe(0);
  });
});

describe('how long lights hold drives', () => {
  const light = destination(from, 90, 1000);
  const t0 = Date.parse('2026-11-02T08:00:00+10:00');
  /** A drive east at 10 m/s with a fix a second, stopped for `stopS` 10 m before the lights. */
  async function lightTrip(userId: string, stopS: number) {
    const trip = await t.db.query<{ id: string }>(
      `INSERT INTO trips (user_id, mode, source, started_at, ended_at) VALUES ($1, 'car', 'navigation', $2, $3) RETURNING id`,
      [userId, new Date(t0), new Date(t0 + 400_000)],
    );
    const id = trip.rows[0]!.id;
    const fixes: Array<{ p: LngLat; ts: number }> = [];
    let m = 0;
    let held = 0;
    for (let ts = t0; m <= 2000; ts += 1000) {
      fixes.push({ p: destination(from, 90, m), ts });
      if (m >= 990 && held < stopS) held++;
      else m += 10;
    }
    await t.db.query(
      `INSERT INTO track_points (user_id, trip_id, batch_id, source, mode, ts, lon, lat)
       SELECT $1, $2, gen_random_uuid(), 'navigation', 'car', ts, lon, lat FROM unnest($3::timestamptz[], $4::float8[], $5::float8[]) AS x(ts, lon, lat)`,
      [userId, id, fixes.map((f) => new Date(f.ts)), fixes.map((f) => f.p[0]), fixes.map((f) => f.p[1])],
    );
    return id;
  }
  const matcher = {
    async match(points: ReadonlyArray<{ lon: number; lat: number }>) {
      // The road itself, a point every 20 m, whatever the fixes.
      void points;
      const coordinates = Array.from({ length: 101 }, (_, i) => destination(from, 90, i * 20));
      return { distance: 2000, time: 0, points: { type: 'LineString' as const, coordinates }, instructions: [], details: { osm_way_id: [[0, 100, 801]] } };
    },
  };

  it('times each drive through them, learns how long they usually hold drives going that way, and routes allow for it', async () => {
    await t.db.query(`INSERT INTO traffic_signals (id, lon, lat, kind) VALUES (9, $1, $2, 'signals')`, light);
    const a = await makeUser(t.db, 'stopper@example.com');
    const b = await makeUser(t.db, 'other-stopper@example.com');
    for (let i = 0; i < 3; i++) await lightTrip(a.id, 40);
    for (let i = 0; i < 2; i++) await lightTrip(b.id, i ? 40 : 0);
    await roads.matchTrips(t.db, matcher as never, a.id);
    await roads.matchTrips(t.db, matcher as never, b.id);
    const passes = await t.db.query<{ stopped: boolean; direction: string }>('SELECT stopped, direction FROM signal_passes ORDER BY id');
    expect(passes.rows.map((p) => p.stopped)).toEqual([true, true, true, false, true]);
    expect(new Set(passes.rows.map((p) => p.direction))).toEqual(new Set(['2straight']));

    // The test drives were on a Monday; route at any time on any day, so the day's timing is copied to the weekend.
    await t.db.query(`INSERT INTO signal_passes (trip_id, signal_id, direction, day_kind, hour, stopped, wait_s, local_day, arrive_s, green_s, observed_at)
                      SELECT trip_id, signal_id, direction, 1, hour, stopped, wait_s, local_day, arrive_s, green_s, observed_at FROM signal_passes`);
    await t.db.query(`UPDATE signal_passes SET observed_at = now() - interval '30 days'`);
    expect(await lightTiming.rebuildLightTimings(t.db)).toMatchObject({ lights: 1, cycles: 0, pruned: 0 });

    const u = await makeUser(t.db, 'router@example.com');
    const route = await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [] });
    const timing = route.trafficSignals![0]!.timing!;
    // Each person counts once: one always stopped, the other half the time.
    expect(timing.stopChance).toBeCloseTo(0.75);
    expect(timing.waitS).toBeCloseTo(40, -1);
    expect(route.durationS).toBeCloseTo(3000 / SPEED + 0.75 * 40, -1);

    // The second person a test account: their drives don't count, so one person is left.
    await t.db.query('UPDATE users SET test_account = true WHERE id = $1', [b.id]);
    expect(await lightTiming.rebuildLightTimings(t.db)).toMatchObject({ lights: 0 });
    await t.db.query('UPDATE users SET test_account = false WHERE id = $1', [b.id]);
    expect(await lightTiming.rebuildLightTimings(t.db)).toMatchObject({ lights: 1 });
    // The second person's drives deleted: one person alone doesn't set it.
    await t.db.query(`UPDATE trips SET deleted_at = now() WHERE user_id = $1`, [b.id]);
    expect(await lightTiming.rebuildLightTimings(t.db)).toMatchObject({ lights: 0 });
    expect((await routing.fastestRoute(deps(), u.id, { from, to, mode: 'car', via: [] })).trafficSignals![0]!.timing).toBeUndefined();
    await t.db.query('DELETE FROM trips');
    expect(Number((await t.db.query<{ n: string }>('SELECT count(*) AS n FROM signal_passes')).rows[0]!.n)).toBe(0);
    await t.db.query('DELETE FROM traffic_signals');
  });
});
