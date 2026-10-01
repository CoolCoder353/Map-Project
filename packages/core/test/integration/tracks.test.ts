import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type LngLat, bboxOf, destination, lineLengthM } from '@wayfinder/shared';
import * as tracks from '../../src/services/tracks.js';
import * as coverage from '../../src/services/coverage.js';
import * as roads from '../../src/services/roads.js';
import * as admin from '../../src/services/admin.js';
import { type TestDb, createTestDb } from '../helpers/db.js';
import { FakeQueue } from '../helpers/fakes.js';
import { makeUser } from '../helpers/users.js';

let t: TestDb;
const queue = new FakeQueue();

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

const HOUR = 3600_000;
const base = Date.now() - 48 * HOUR;

function drive(startTs: number, start: LngLat, bearing: number, km: number, speedMps: number, everyS = 5) {
  const n = Math.round((km * 1000) / (speedMps * everyS));
  return Array.from({ length: n + 1 }, (_, i) => {
    const [lon, lat] = destination(start, bearing, speedMps * everyS * i);
    return { ts: startTs + i * everyS * 1000, lon, lat, accuracyM: 8, speedMps };
  });
}

/**
 * Stands in for the routing engine's map matching: every point is "on" the given ways, one run
 * per way, so a trip's roads are predictable.
 */
const fakeMatcher = (wayIds: number[]) => ({
  async match(points: ReadonlyArray<{ lon: number; lat: number }>) {
    const coordinates = points.map((p) => [p.lon, p.lat] as LngLat);
    const per = Math.max(1, Math.floor((coordinates.length - 1) / wayIds.length));
    const runs = wayIds.map((id, i) => [i * per, Math.min(coordinates.length - 1, (i + 1) * per), id] as [number, number, number]);
    return { distance: 0, time: 0, points: { type: 'LineString' as const, coordinates }, instructions: [], details: { osm_way_id: runs } };
  },
});

async function runJobs(userId: string, matcher = fakeMatcher([101, 102])) {
  for (const job of queue.take('process-tracks')) {
    await tracks.processUserTracks(t.db, job.data.userId as string);
    await roads.matchTrips(t.db, matcher as never, job.data.userId as string);
  }
  for (const job of queue.take('rebuild-coverage')) {
    await coverage.loadVisitedCells(t.db, userId).then(() => tracks.rebuildCoverage(t.db, job.data.userId as string));
    await roads.matchTrips(t.db, matcher as never, job.data.userId as string, 500);
  }
}

/**
 * Upload as a phone does while travelling: the clock just after the batch's last fix. (Points
 * already a trip gap old are settled: nothing more can join them.)
 */
async function uploadLive(userId: string, points: ReturnType<typeof drive>, matcher = fakeMatcher([101, 102])) {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(points.at(-1)!.ts + 20_000);
    await tracks.ingestBatch(t.db, queue, userId, { batchId: randomUUID(), source: 'background', points });
    await runJobs(userId, matcher);
  } finally {
    vi.useRealTimers();
  }
}

const cellCount = async (userId: string) =>
  Number((await t.db.query<{ n: string }>('SELECT count(*) AS n FROM visited_cells WHERE user_id = $1', [userId])).rows[0]!.n);

describe('track ingestion and coverage', () => {
  it('turns uploaded batches into trips and visited cells, idempotently', async () => {
    const u = await makeUser(t.db, 'walker@example.com');
    const walk = drive(base, [149.13, -35.28], 90, 2, 1.4);
    const batchId = randomUUID();
    const res = await tracks.ingestBatch(t.db, queue, u.id, { batchId, source: 'background', points: walk });
    expect(res).toEqual({ accepted: walk.length, duplicate: false });
    expect(await tracks.ingestBatch(t.db, queue, u.id, { batchId, source: 'background', points: walk })).toEqual({
      accepted: 0,
      duplicate: true,
    });
    await runJobs(u.id);
    const list = await tracks.listTrips(t.db, u.id, 10);
    expect(list.items).toHaveLength(1);
    const trip = list.items[0]!;
    expect(trip.mode).toBe('foot');
    expect(trip.distanceM).toBeGreaterThan(1900);
    expect(trip.distanceM).toBeLessThan(2100);
    expect(trip.newRoads).toBe(2); // both roads the walk was matched onto were new

    const stats = await coverage.getCoverageStats(t.db, u.id);
    // Coverage counts roads travelled; the walk was matched onto two of them.
    expect(stats.roadsTravelled).toBe(2);
    expect(stats.roadKm).toBeGreaterThan(1.5);
    expect(stats.byMode.footKm).toBe(stats.roadKm);
    expect(stats.byMode.carKm).toBe(0);
    expect(stats.tripCount).toBe(1);
    // Hexagons stay as the internal index that steers explore, and are no longer reported.
    expect(await cellCount(u.id)).toBeGreaterThanOrEqual(5); // ~350 m wide cells along 2 km

    const detail = await tracks.getTrip(t.db, u.id, trip.id);
    expect(detail.points).toHaveLength(walk.length);
    expect(detail.geometry.length).toBeLessThan(walk.length); // simplified
  });

  it('joins consecutive batches into one trip and splits after a long gap; mode by speed', async () => {
    const u = await makeUser(t.db, 'driver@example.com');
    const leg = drive(base, [149.0, -35.2], 0, 10, 20);
    const half = Math.floor(leg.length / 2);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: leg.slice(0, half) });
    await runJobs(u.id);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: leg.slice(half) });
    await runJobs(u.id);
    const later = drive(base + 5 * HOUR, [149.2, -35.4], 180, 5, 20);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: later });
    await runJobs(u.id);

    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.mode === 'car')).toBe(true);
    const long = items.find((i) => i.distanceM > 9000)!;
    expect(long.distanceM).toBeLessThan(10_500);
    const detail = await tracks.getTrip(t.db, u.id, long.id);
    expect(detail.points).toHaveLength(leg.length);
  });

  it('re-matches a trip that grew, so roads driven after the first upload still count', async () => {
    const u = await makeUser(t.db, 'grower@example.com');
    const leg = drive(base, [148.5, -35.0], 0, 10, 20);
    const half = Math.floor(leg.length / 2);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: leg.slice(0, half) });
    await runJobs(u.id, fakeMatcher([201]));
    // The rest of the same drive arrives later and extends the trip rather than starting a new one.
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: leg.slice(half) });
    await runJobs(u.id, fakeMatcher([201, 202]));

    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(1);
    expect([...(await roads.visitedWayIds(t.db, u.id))].sort()).toEqual([201, 202]);
    // Both roads count as new for this trip: the one it started on and the one it reached later.
    expect(items[0]!.newRoads).toBe(2);
    const row = (
      await t.db.query<{ n: number; point_count: number }>(
        'SELECT jsonb_array_length(matched_geometry) AS n, point_count FROM trips WHERE user_id = $1',
        [u.id],
      )
    ).rows[0]!;
    expect(row.n).toBe(row.point_count);
  });

  it('a fix too inaccurate to use does not split the rest of the drive into one trip per upload', async () => {
    const u = await makeUser(t.db, 'fuzzy@example.com');
    // Uploaded as it happens, a batch at a time.
    const leg = drive(base, [148.0, -34.5], 0, 6, 15);
    leg[10] = { ...leg[10]!, accuracyM: 80 };
    for (let i = 0; i < leg.length; i += 20) await uploadLive(u.id, leg.slice(i, i + 20));
    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(1);
    expect((await tracks.getTrip(t.db, u.id, items[0]!.id)).points).toHaveLength(leg.length - 1);
  });

  it('a stop spread over several uploads ends the trip, and the parked time is not part of it', async () => {
    const u = await makeUser(t.db, 'parker@example.com');
    const first = drive(base, [147.5, -34.0], 0, 3, 15);
    const end = first.at(-1)!;
    // Twelve minutes parked: GPS wanders a few metres, a fix every 30 s, uploaded every 3 minutes.
    const parked = Array.from({ length: 24 }, (_, i) => ({
      ts: end.ts + (i + 1) * 30_000,
      lon: end.lon + (i % 3) * 0.00004,
      lat: end.lat + (i % 2) * 0.00003,
      accuracyM: 12,
      speedMps: 0,
    }));
    const second = drive(parked.at(-1)!.ts + 5000, [end.lon, end.lat + 0.001], 0, 3, 15);
    for (const points of [first, ...[0, 6, 12, 18].map((i) => parked.slice(i, i + 6)), second]) await uploadLive(u.id, points);
    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(2);
    const earlier = items.at(-1)!;
    expect(new Date(earlier.endedAt).getTime()).toBe(end.ts);
    expect(new Date(items[0]!.endedAt).getTime()).toBe(second.at(-1)!.ts);
  });

  it('a rest held back at the end of the last upload is settled once nothing more comes', async () => {
    const u = await makeUser(t.db, 'home@example.com');
    const home = drive(base, [147.2, -34.0], 0, 3, 15);
    const end = home.at(-1)!;
    // Home: three minutes of fixes in the driveway, then the phone goes quiet.
    const driveway = Array.from({ length: 6 }, (_, i) => ({ ts: end.ts + (i + 1) * 30_000, lon: end.lon, lat: end.lat + (i % 2) * 0.00003, accuracyM: 10, speedMps: 0 }));
    await uploadLive(u.id, [...home, ...driveway]);
    const unassigned = async () =>
      (await t.db.query('SELECT count(*)::int AS n FROM track_points WHERE user_id = $1 AND trip_id IS NULL', [u.id])).rows[0].n as number;
    expect(await unassigned()).toBeGreaterThan(0);
    // The daily pass over points left unassigned: the trip ends where the car stopped.
    await tracks.processUserTracks(t.db, u.id);
    expect(await unassigned()).toBe(0);
    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(1);
    expect(new Date(items[0]!.endedAt).getTime()).toBe(end.ts);
  });

  it('a navigated drive is one trip, even though background recording saw it too', async () => {
    const u = await makeUser(t.db, 'twice@example.com');
    const session = randomUUID();
    const leg = drive(base, [147.0, -33.5], 0, 16, 15);
    const nav = { source: 'navigation' as const, mode: 'car' as const, navigationSessionId: session };
    // Both arrive together…
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: leg.slice(0, 100) });
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), ...nav, points: leg.slice(0, 100) });
    await runJobs(u.id);
    // …or the background copy arrives after the navigation trip was already made.
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), ...nav, points: leg.slice(100, 200) });
    await runJobs(u.id);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: leg.slice(100, 200) });
    await runJobs(u.id);
    // Driving on after navigation ended is recorded as usual.
    const after = drive(leg[199]!.ts + 60_000, [148.5, -33.5], 90, 3, 15);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: after });
    await runJobs(u.id);

    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items.map((i) => i.source)).toEqual(['background', 'navigation']);
    expect((await tracks.getTrip(t.db, u.id, items[1]!.id)).points).toHaveLength(200);
    expect(new Date(items[0]!.startedAt).getTime()).toBeGreaterThan(leg[199]!.ts);
    const strays = await t.db.query('SELECT count(*)::int AS n FROM track_points WHERE user_id = $1 AND trip_id IS NULL', [u.id]);
    expect(strays.rows[0].n).toBe(0);
  });

  it('skips a road the matcher touched for no distance at all', async () => {
    const u = await makeUser(t.db, 'touch@example.com');
    const start: LngLat = [146.0, -33.0];
    // Way 402 is only a single repeated point where the trip brushed past it.
    const matcher = {
      async match(points: ReadonlyArray<{ lon: number; lat: number }>) {
        const coordinates = points.map((p) => [p.lon, p.lat] as LngLat);
        coordinates.splice(1, 0, coordinates[1]!);
        const last = coordinates.length - 1;
        return { distance: 0, time: 0, points: { type: 'LineString' as const, coordinates }, instructions: [], details: { osm_way_id: [[0, 1, 401], [1, 2, 402], [2, last, 401]] as [number, number, number][] } };
      },
    };
    await uploadLive(u.id, drive(base, start, 90, 2, 20), matcher as never);
    expect([...(await roads.visitedWayIds(t.db, u.id))]).toEqual([401]);
    expect((await tracks.listTrips(t.db, u.id, 10)).items[0]!.newRoads).toBe(1);
  });

  it('draws every stretch of a road travelled on different trips, and counts each metre once', async () => {
    const u = await makeUser(t.db, 'stretches@example.com');
    const west: LngLat = [146.5, -33.0];
    const east = destination(west, 90, 4000);
    const upload = async (points: ReturnType<typeof drive>) => {
      await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points });
      await runJobs(u.id, fakeMatcher([301]));
    };
    // One long road: its west end one day, its east end later, then the west end again.
    await upload(drive(base, west, 90, 2, 20));
    await upload(drive(base + 5 * HOUR, east, 90, 2, 20));
    await upload(drive(base + 10 * HOUR, west, 90, 2, 20));

    const view = await coverage.getCoverage(t.db, u.id, bboxOf([west, destination(east, 90, 2000)], 500), 15);
    expect(view.roads.map((r) => r.wayId)).toEqual([301, 301]);
    const drawn = view.roads.map((r) => lineLengthM(r.geometry));
    expect(drawn.every((m) => m > 1900)).toBe(true);
    const stats = await coverage.getCoverageStats(t.db, u.id);
    expect(stats.roadsTravelled).toBe(1);
    expect(stats.roadKm).toBeCloseTo(4, 1);
    // Framing the map around them: the whole road, from the west end to the east.
    const [w, s, e, n] = stats.bounds!;
    expect(w).toBeCloseTo(west[0], 3);
    expect(e).toBeCloseTo(destination(east, 90, 2000)[0], 2);
    expect(s).toBeLessThanOrEqual(west[1]);
    expect(n).toBeGreaterThanOrEqual(west[1]);
    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items.map((i) => i.newRoads)).toEqual([0, 0, 1]);
  });

  it('frames the map around where someone has been, leaving out a lone trip far away', async () => {
    const u = await makeUser(t.db, 'framer@example.com');
    expect((await coverage.getCoverageStats(t.db, u.id)).bounds).toBeNull();
    // Sixty roads around Cleveland, and one in Sydney.
    const roadsAt = [...Array.from({ length: 60 }, (_, i) => [153.2 + (i % 10) * 0.01, -27.5 - Math.floor(i / 10) * 0.01]), [151.2, -33.87]];
    await t.db.query(
      `INSERT INTO visited_ways (user_id, way_id, geometry, length_m, first_visited_at, last_visited_at, modes, min_lon, min_lat, max_lon, max_lat)
       SELECT $1, i, '[]', 100, now(), now(), 1, lon, lat, lon + 0.001, lat + 0.001
       FROM unnest($2::float8[], $3::float8[]) WITH ORDINALITY AS r(lon, lat, i)`,
      [u.id, roadsAt.map((p) => p[0]), roadsAt.map((p) => p[1])],
    );
    const [w, s, e, n] = (await coverage.getCoverageStats(t.db, u.id)).bounds!;
    expect(w).toBeGreaterThan(153.19);
    expect(e).toBeLessThan(153.3);
    expect(s).toBeGreaterThan(-27.56);
    expect(n).toBeLessThan(-27.49);
  });

  it('navigation sessions become their own trips with the given mode', async () => {
    const u = await makeUser(t.db, 'nav@example.com');
    const session = randomUUID();
    const pts = drive(base, [149.1, -35.3], 45, 1, 1.3);
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'navigation', mode: 'car', navigationSessionId: session, points: pts.slice(0, 50) });
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'navigation', mode: 'car', navigationSessionId: session, points: pts.slice(50) });
    await runJobs(u.id);
    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'navigation', mode: 'car' });
  });

  it('soft-deleting a trip removes its unique cells; restoring brings them back; purge hard-deletes', async () => {
    const u = await makeUser(t.db, 'deleter@example.com');
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: drive(base, [150.0, -34.0], 90, 2, 1.4) });
    await tracks.ingestBatch(t.db, queue, u.id, { batchId: randomUUID(), source: 'background', points: drive(base + 3 * HOUR, [150.1, -34.1], 90, 2, 1.4) });
    await runJobs(u.id);
    const { items } = await tracks.listTrips(t.db, u.id, 10);
    expect(items).toHaveLength(2);
    const before = await cellCount(u.id);
    const victimCells = Number(
      (await t.db.query<{ n: string }>('SELECT new_cells AS n FROM trips WHERE id = $1', [items[0]!.id])).rows[0]!.n,
    );
    const victim = items[0]!;

    await tracks.softDeleteTrip(t.db, queue, u.id, victim.id);
    await runJobs(u.id);
    const afterDelete = await cellCount(u.id);
    expect(afterDelete).toBe(before - victimCells);
    expect((await tracks.listTrips(t.db, u.id, 10)).items).toHaveLength(1);
    await expect(tracks.getTrip(t.db, u.id, victim.id)).rejects.toMatchObject({ statusCode: 404 });

    await tracks.restoreTrip(t.db, queue, victim.id);
    await runJobs(u.id);
    expect(await cellCount(u.id)).toBe(before);

    await tracks.softDeleteTrip(t.db, queue, u.id, victim.id);
    await runJobs(u.id);
    expect(await admin.purgeDeleted(t.db, new Date())).toEqual({ users: 0, trips: 0 });
    const purged = await admin.purgeDeleted(t.db, new Date(Date.now() + 8 * 86_400_000));
    expect(purged.trips).toBeGreaterThanOrEqual(1);
    const left = await t.db.query('SELECT count(*)::int AS n FROM track_points WHERE trip_id = $1', [victim.id]);
    expect(left.rows[0].n).toBe(0);
    await expect(tracks.restoreTrip(t.db, queue, victim.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('serves the roads travelled inside the map view', async () => {
    const u = (await t.db.query("SELECT id FROM users WHERE email = 'walker@example.com'")).rows[0];
    const bbox: [number, number, number, number] = [149.12, -35.29, 149.16, -35.27];
    const view = await coverage.getCoverage(t.db, u.id, bbox, 15);
    expect(view.roads.length).toBe(2);
    expect(view.roads.map((r) => r.wayId).sort()).toEqual([101, 102]);
    expect(view.roads[0]!.geometry.length).toBeGreaterThan(1);
    expect(view.roads.every((r) => r.recent)).toBe(true);
    expect(view.truncated).toBe(false);

    const geojson = coverage.coverageToGeoJson(view);
    expect(geojson.features[0]!.geometry.type).toBe('LineString');

    const elsewhere = await coverage.getCoverage(t.db, u.id, [140, -30, 140.1, -29.9], 15);
    expect(elsewhere.roads).toHaveLength(0);
  });

});
