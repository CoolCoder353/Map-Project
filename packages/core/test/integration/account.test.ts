import { randomUUID } from 'node:crypto';
import { destination } from '@wayfinder/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportUserData } from '../../src/services/account.js';
import { ingestBatch, processUserTracks } from '../../src/services/tracks.js';
import { type TestDb, createTestDb } from '../helpers/db.js';
import { FakeQueue } from '../helpers/fakes.js';
import { makeUser } from '../helpers/users.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

async function recordTrip(userId: string, startMs: number) {
  const points = Array.from({ length: 60 }, (_, i) => {
    const [lon, lat] = destination([153.02, -27.47], 90, i * 15);
    return { ts: startMs + i * 5000, lon, lat, accuracyM: 6 };
  });
  await ingestBatch(t.db, new FakeQueue(), userId, { batchId: randomUUID(), source: 'background', points });
  await processUserTracks(t.db, userId);
}

describe('Download my data', () => {
  it('includes the account, trips with their points, roads travelled, cells and planned routes', async () => {
    const u = await makeUser(t.db, 'export@example.test');
    const other = await makeUser(t.db, 'someone-else@example.test');
    await recordTrip(u.id, Date.parse('2026-09-20T08:00:00Z'));
    await recordTrip(u.id, Date.parse('2026-09-21T08:00:00Z'));
    await recordTrip(other.id, Date.parse('2026-09-20T08:00:00Z'));
    const [kept, deleted] = (await t.db.query<{ id: string }>('SELECT id FROM trips WHERE user_id = $1 ORDER BY started_at', [u.id])).rows;
    await t.db.query('UPDATE trips SET deleted_at = now(), new_roads = 0 WHERE id = $1', [deleted!.id]);
    await t.db.query('UPDATE trips SET new_roads = 2 WHERE id = $1', [kept!.id]);
    await t.db.query(
      `INSERT INTO visited_ways (user_id, way_id, geometry, length_m, first_visited_at, last_visited_at, modes, min_lon, min_lat, max_lon, max_lat)
       VALUES ($1, 9007199254, '[[153.02,-27.47],[153.03,-27.47]]', 990, '2026-09-20T08:01:00Z', '2026-09-21T08:01:00Z', 3, 153.02, -27.47, 153.03, -27.47)`,
      [u.id],
    );
    await t.db.query(`INSERT INTO planned_routes (user_id, name, route) VALUES ($1, 'To work', '{"id":"r"}')`, [u.id]);

    const data = await exportUserData(t.db, u.id);
    expect(data.user).toMatchObject({ email: 'export@example.test', role: 'user' });
    expect(data.trips.features).toHaveLength(1);
    const trip = data.trips.features[0]!;
    expect(trip.properties).toMatchObject({ id: kept!.id, mode: expect.any(String), newRoads: 2, startedAt: '2026-09-20T08:00:00.000Z' });
    expect(trip.geometry.coordinates.length).toBe(trip.properties.timestamps.length);
    expect(trip.geometry.coordinates.length).toBeGreaterThan(50);
    expect(data.travelledRoads.features).toEqual([
      {
        type: 'Feature',
        properties: { osmWayId: 9007199254, lengthM: 990, firstTravelledAt: '2026-09-20T08:01:00.000Z', lastTravelledAt: '2026-09-21T08:01:00.000Z', modes: ['car', 'foot'] },
        geometry: { type: 'LineString', coordinates: [[153.02, -27.47], [153.03, -27.47]] },
      },
    ]);
    expect(data.visitedCells.length).toBeGreaterThan(0);
    expect(data.visitedCells[0]).toMatchObject({ h3: expect.stringMatching(/^[0-9a-f]{15}$/), visitCount: expect.any(Number) });
    expect(data.plannedRoutes).toEqual([expect.objectContaining({ name: 'To work', route: { id: 'r' } })]);
    expect(data.stats).toMatchObject({ roadsTravelled: 1, tripCount: 1 });
    expect(data.note).toMatch(/kept for 7 days/);
    // Nothing of anyone else's.
    expect(JSON.stringify(data)).not.toContain(other.id);
  });
});
