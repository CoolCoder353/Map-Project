import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
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
