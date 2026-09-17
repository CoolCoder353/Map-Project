/**
 * Runs against a REAL GraphHopper with the Australia graph. Skipped unless
 * GRAPHHOPPER_LIVE_URL is set, e.g.
 *   GRAPHHOPPER_LIVE_URL=http://localhost:8989 pnpm test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LngLat, cellToBigInt, parentCell, pathCells } from '@wayfinder/shared';
import { GraphHopperClient } from '../../src/lib/graphhopper.js';
import { MetricsAggregator } from '../../src/lib/metrics.js';
import * as routing from '../../src/services/routing.js';
import { type TestDb, createTestDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';

const liveUrl = process.env.GRAPHHOPPER_LIVE_URL;
const braddon: LngLat = [149.135, -35.271];
const lanyon: LngLat = [149.0848, -35.4917];
const civic: LngLat = [149.1301, -35.2809];

describe.skipIf(!liveUrl)('routing against the real graph', () => {
  let t: TestDb;
  let userId: string;
  const gh = new GraphHopperClient(liveUrl ?? '');
  const deps = () => ({ db: t.db, graphhopper: gh, metrics: new MetricsAggregator(async () => undefined) });

  beforeAll(async () => {
    t = await createTestDb();
    userId = (await makeUser(t.db, 'live@example.com')).id;
    // Mark the direct corridor as already travelled.
    const cells = pathCells([braddon, lanyon]);
    await t.db.query(
      `INSERT INTO visited_cells (user_id, cell, r7, r5, first_visited_at, last_visited_at, modes)
       SELECT $1, c, r7, r5, now() - interval '20 days', now(), 1 FROM unnest($2::bigint[], $3::bigint[], $4::bigint[]) AS t(c, r7, r5)
       ON CONFLICT DO NOTHING`,
      [userId, cells.map((c) => cellToBigInt(c).toString()), cells.map((c) => cellToBigInt(parentCell(c, 7)).toString()), cells.map((c) => cellToBigInt(parentCell(c, 5)).toString())],
    );
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  it('routes on real roads with turn instructions', async () => {
    const r = await routing.fastestRoute(deps(), userId, { from: braddon, to: lanyon, mode: 'car', via: [] });
    expect(r.distanceM).toBeGreaterThan(20_000);
    expect(r.distanceM).toBeLessThan(60_000);
    expect(r.durationS).toBeGreaterThan(900);
    expect(r.geometry.length).toBeGreaterThan(100);
    expect(r.instructions.length).toBeGreaterThan(5);
    expect(r.instructions.some((i) => i.streetName.length > 0)).toBe(true);
    expect(r.instructions.at(-1)!.sign).toBe(4);
  }, 60_000);

  it('walking routes use paths and are slower than driving', async () => {
    const [walk, drive] = await Promise.all([
      routing.fastestRoute(deps(), userId, { from: braddon, to: civic, mode: 'foot', via: [] }),
      routing.fastestRoute(deps(), userId, { from: braddon, to: civic, mode: 'car', via: [] }),
    ]);
    expect(walk.durationS).toBeGreaterThan(drive.durationS);
    expect(walk.distanceM).toBeLessThan(6000);
  }, 60_000);

  it('explore routes add new ground within the time budget', async () => {
    const res = await routing.exploreRoutes(deps(), userId, { from: braddon, to: lanyon, mode: 'car', budgetMin: 20 });
    expect(res.fastest.novelty.noveltyPct).toBeLessThan(35); // the corridor is already visited
    expect(res.explore.length).toBeGreaterThan(0);
    for (const e of res.explore) {
      expect(e.durationS).toBeLessThanOrEqual(res.fastest.durationS + 20 * 60 + 1);
      expect(e.novelty.newKm).toBeGreaterThan(res.fastest.novelty.newKm);
      expect(e.geometry.length).toBeGreaterThan(50);
    }
  }, 120_000);

  it('round trips come back to the start near the target duration', async () => {
    const loops = await routing.roundTrips(deps(), userId, { start: civic, mode: 'foot', targetMin: 60 });
    expect(loops.length).toBeGreaterThan(0);
    for (const l of loops) {
      expect(Math.abs(l.durationS - 3600)).toBeLessThanOrEqual(3600 * 0.2);
      const start = l.geometry[0]!;
      const end = l.geometry.at(-1)!;
      expect(Math.hypot(start[0] - end[0], start[1] - end[1])).toBeLessThan(0.001);
    }
  }, 180_000);
});
