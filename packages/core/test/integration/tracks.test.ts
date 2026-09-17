import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, destination } from '@wayfinder/shared';
import * as tracks from '../../src/services/tracks.js';
import * as coverage from '../../src/services/coverage.js';
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

async function runJobs(userId: string) {
  for (const job of queue.take('process-tracks')) await tracks.processUserTracks(t.db, job.data.userId as string);
  for (const job of queue.take('rebuild-coverage')) await coverage.loadVisitedCells(t.db, userId).then(() => tracks.rebuildCoverage(t.db, job.data.userId as string));
}

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
    expect(trip.newCells).toBeGreaterThanOrEqual(5); // ~350 m wide cells along 2 km

    const stats = await coverage.getCoverageStats(t.db, u.id);
    expect(stats.cellsVisited).toBe(trip.newCells);
    expect(stats.byMode.foot).toBe(stats.cellsVisited);
    expect(stats.byMode.car).toBe(0);
    expect(stats.tripCount).toBe(1);

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
    const before = (await coverage.getCoverageStats(t.db, u.id)).cellsVisited;
    const victim = items[0]!;

    await tracks.softDeleteTrip(t.db, queue, u.id, victim.id);
    await runJobs(u.id);
    const afterDelete = (await coverage.getCoverageStats(t.db, u.id)).cellsVisited;
    expect(afterDelete).toBe(before - victim.newCells);
    expect((await tracks.listTrips(t.db, u.id, 10)).items).toHaveLength(1);
    await expect(tracks.getTrip(t.db, u.id, victim.id)).rejects.toMatchObject({ statusCode: 404 });

    await tracks.restoreTrip(t.db, queue, victim.id);
    await runJobs(u.id);
    expect((await coverage.getCoverageStats(t.db, u.id)).cellsVisited).toBe(before);

    await tracks.softDeleteTrip(t.db, queue, u.id, victim.id);
    await runJobs(u.id);
    expect(await admin.purgeDeleted(t.db, new Date())).toEqual({ users: 0, trips: 0 });
    const purged = await admin.purgeDeleted(t.db, new Date(Date.now() + 8 * 86_400_000));
    expect(purged.trips).toBeGreaterThanOrEqual(1);
    const left = await t.db.query('SELECT count(*)::int AS n FROM track_points WHERE trip_id = $1', [victim.id]);
    expect(left.rows[0].n).toBe(0);
    await expect(tracks.restoreTrip(t.db, queue, victim.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('serves coverage at zoom-dependent resolutions within a bbox', async () => {
    const u = (await t.db.query("SELECT id FROM users WHERE email = 'walker@example.com'")).rows[0];
    const bbox: [number, number, number, number] = [149.12, -35.29, 149.16, -35.27];
    const fine = await coverage.getCoverage(t.db, u.id, bbox, 15);
    expect(fine.res).toBe(9);
    expect(fine.cells.length).toBeGreaterThanOrEqual(5);
    expect(fine.cells.every((c) => c.fraction === 1)).toBe(true);
    const coarse = await coverage.getCoverage(t.db, u.id, bbox, 9);
    expect(coarse.res).toBe(6);
    expect(coarse.cells.length).toBeGreaterThanOrEqual(1);
    expect(coarse.cells[0]!.fraction).toBeLessThan(1);
    const elsewhere = await coverage.getCoverage(t.db, u.id, [140, -30, 140.1, -29.9], 15);
    expect(elsewhere.cells).toHaveLength(0);
  });
});
