/**
 * Spike 1 benchmark: explore A→B and round-trip latency for a heavy user (default 50k visited
 * cells) against a REAL GraphHopper with the Australia graph.
 *
 *   DATABASE_URL=... GRAPHHOPPER_URL=http://localhost:8989 pnpm bench:explore [cells] [runs]
 *
 * Targets (design spec): explore p95 < 2 s, round trip p95 < 3 s.
 */
import { randomUUID } from 'node:crypto';
import { gridDisk } from 'h3-js';
import { GraphHopperClient, MetricsAggregator, createPool, hashPassword, migrate, routingService } from '@wayfinder/core';
import { type LngLat, cellToBigInt, destination, parentCell, pointToCell } from '@wayfinder/shared';

const url = process.env.DATABASE_URL;
const ghUrl = process.env.GRAPHHOPPER_URL ?? 'http://localhost:8989';
if (!url) throw new Error('DATABASE_URL required');
const targetCells = Number(process.argv[2] ?? 50_000);
const runs = Number(process.argv[3] ?? 20);

const db = createPool(url, 4);
await migrate(db);
const gh = new GraphHopperClient(ghUrl);
if (!(await gh.health()).up) throw new Error(`GraphHopper not reachable at ${ghUrl}`);

// Synthetic heavy user around Sydney: clusters of visited cells along "commutes".
const email = `bench-${randomUUID().slice(0, 8)}@bench.test`;
const userId = (await db.query<{ id: string }>('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, await hashPassword('bench password')])).rows[0]!.id;
const sydney: LngLat = [151.2093, -33.8688];
const cells = new Set<string>();
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
while (cells.size < targetCells) {
  const centre = destination(sydney, rand() * 360, rand() * 40_000);
  for (const c of gridDisk(pointToCell(centre), 3 + Math.floor(rand() * 6))) cells.add(c);
}
const list = [...cells].slice(0, targetCells);
for (let i = 0; i < list.length; i += 5000) {
  const chunk = list.slice(i, i + 5000);
  await db.query(
    `INSERT INTO visited_cells (user_id, cell, r7, r5, first_visited_at, last_visited_at, modes)
     SELECT $1, c, r7, r5, now() - interval '30 days', now(), 1 FROM unnest($2::bigint[], $3::bigint[], $4::bigint[]) AS t(c, r7, r5)
     ON CONFLICT DO NOTHING`,
    [userId, chunk.map((c) => cellToBigInt(c).toString()), chunk.map((c) => cellToBigInt(parentCell(c, 7)).toString()), chunk.map((c) => cellToBigInt(parentCell(c, 5)).toString())],
  );
}
console.log(`Seeded ${list.length} visited cells for ${email}`);

const deps = { db, graphhopper: gh, metrics: new MetricsAggregator(async () => undefined) };
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * q) - 1)]!;
async function measure(name: string, fn: () => Promise<unknown>) {
  const times: number[] = [];
  let failures = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    try {
      await fn();
      times.push(performance.now() - t0);
    } catch (err) {
      failures++;
      if (failures <= 2) console.warn(`${name} failed:`, (err as Error).message);
    }
  }
  if (times.length) console.log(`${name}: n=${times.length} fail=${failures} p50=${Math.round(pct(times, 0.5))} ms p95=${Math.round(pct(times, 0.95))} ms max=${Math.round(Math.max(...times))} ms`);
  return times.length ? pct(times, 0.95) : Infinity;
}

const trips: Array<[LngLat, LngLat]> = Array.from({ length: runs }, () => {
  const a = destination(sydney, rand() * 360, rand() * 25_000);
  return [a, destination(a, rand() * 360, 8_000 + rand() * 22_000)];
});
let k = 0;
const exploreP95 = await measure('explore car A→B (+15 min)', () => {
  const [from, to] = trips[k++ % trips.length]!;
  return routingService.exploreRoutes(deps, userId, { from, to, mode: 'car', budgetMin: 15 });
});
const loopP95 = await measure('round trip foot 60 min', () =>
  routingService.roundTrips(deps, userId, { start: destination(sydney, rand() * 360, rand() * 20_000), mode: 'foot', targetMin: 60 }),
);
console.log(`\nTargets: explore p95 < 2000 ms → ${exploreP95 < 2000 ? 'PASS' : 'FAIL'}; round trip p95 < 3000 ms → ${loopP95 < 3000 ? 'PASS' : 'FAIL'}`);
await db.query('DELETE FROM users WHERE id = $1', [userId]);
await db.end();
