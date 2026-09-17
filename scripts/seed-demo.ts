/**
 * Seed a development database with clearly-labelled DEMO data: an admin, a dev, two users,
 * invites, synthetic trips around Canberra, places/POIs, metrics, an error and pipeline runs.
 *   DATABASE_URL=... pnpm seed:demo
 * Never run against production.
 */
import { randomUUID } from 'node:crypto';
import {
  MetricsAggregator,
  audit,
  createPool,
  hashPassword,
  inviteService,
  metricsWriter,
  migrate,
  placeService,
  recordErrorEvent,
  trackService,
} from '@wayfinder/core';
import { destination } from '@wayfinder/shared';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
const db = createPool(url, 2);
await migrate(db);

const password = await hashPassword('demo password');
async function user(email: string, role: 'user' | 'dev' | 'admin', trackingEnabled: boolean) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, settings, last_seen_at) VALUES ($1, $2, $3, $4, now() - random() * interval '2 days')
     ON CONFLICT ((lower(email))) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
    [email, password, role, JSON.stringify({ trackingEnabled, defaultMode: 'car', exploreBudgetMin: 15 })],
  );
  return r.rows[0]!.id;
}
const adminId = await user('admin@demo.test', 'admin', true);
await user('dev@demo.test', 'dev', false);
const samId = await user('sam@demo.test', 'user', true);
await user('alex@demo.test', 'user', false);

const queue = { send: async () => null };
const now = Date.now();
const canberra: [number, number] = [149.13, -35.28];
let batchCount = 0;
for (let d = 1; d <= 14; d++) {
  for (const [who, mode, km, speed] of [
    [adminId, 'car', 12 + d, 14],
    [samId, 'foot', 2 + (d % 4), 1.4],
  ] as const) {
    const start = now - d * 86_400_000 + (8 + (d % 5)) * 3600_000;
    const bearing = (d * 47) % 360;
    const origin = destination(canberra, (d * 83) % 360, 2000 + d * 700);
    const n = Math.round((km * 1000) / (speed * 5));
    const points = Array.from({ length: n }, (_, i) => {
      const wiggle = Math.sin(i / 25) * 25;
      const [lon, lat] = destination(origin, bearing + wiggle, speed * 5 * i);
      return { ts: start + i * 5000, lon, lat, accuracyM: 8, speedMps: speed };
    });
    await trackService.ingestBatch(db, queue, who, { batchId: randomUUID(), source: 'background', points });
    batchCount++;
  }
}
await trackService.processUserTracks(db, adminId);
await trackService.processUserTracks(db, samId);

const places = [
  ['c1', 'Canberra', 'city', null, 'Australian Capital Territory', 149.13, -35.28, 1],
  ['s1', 'Braddon', 'suburb', null, 'Suburb', 149.135, -35.271, 0.2],
  ['s2', 'Kingston', 'suburb', null, 'Suburb', 149.146, -35.315, 0.2],
  ['p1', 'Mount Ainslie Lookout', 'poi', 'viewpoint', 'Lookout, Campbell', 149.1563, -35.2702, 0.1],
  ['p2', 'Black Mountain Summit', 'poi', 'peak', 'Peak', 149.0987, -35.2757, 0.1],
  ['p3', 'Ginninderra Falls', 'poi', 'waterfall', 'Waterfall', 148.9658, -35.2303, 0.1],
  ['p4', 'Namadgi Visitor Centre Trailhead', 'poi', 'trailhead', 'Trailhead, Tharwa', 149.0677, -35.5913, 0.1],
  ['p5', 'Lake Burley Griffin foreshore', 'poi', 'park', 'Park', 149.1285, -35.2932, 0.1],
  ['p6', 'Lanyon Homestead', 'poi', 'historic', 'Historic site', 149.0848, -35.4917, 0.1],
  ['p7', 'Two Before Ten', 'poi', 'cafe', 'Café, Aranda', 149.0823, -35.2596, 0.1],
  ['r1', 'Northbourne Avenue', 'street', null, 'Braddon', 149.1313, -35.2703, 0],
  ['a1', '10 Lonsdale Street', 'address', null, 'Braddon 2612', 149.1349, -35.2758, 0],
] as const;
await placeService.upsertPlaces(
  db,
  places.map(([id, name, kind, category, description, lon, lat, importance]) => ({ id, name, kind, category, description, lon, lat, importance })),
);

const codes = await inviteService.createInvites(db, { count: 3, expiresInDays: 14, note: 'demo', roleOnSignup: 'user', createdBy: adminId });
await audit(db, { actorId: adminId, action: 'invite.create', targetType: 'invite', details: { count: 3, demo: true } });
await audit(db, { actorId: adminId, action: 'user.view_trips', targetType: 'user', targetId: samId });

// Synthetic metrics for the last 48 hours.
let fakeNow = now - 48 * 3600_000;
const metrics = new MetricsAggregator(metricsWriter(db), () => fakeNow);
for (; fakeNow < now; fakeNow += 10 * 60_000) {
  const hour = new Date(fakeNow).getHours();
  const load = hour >= 7 && hour <= 22 ? 20 : 3;
  for (let i = 0; i < load; i++) {
    metrics.record('http.request', 'POST /api/routes/explore', 400 + Math.random() * 1400, Math.random() < 0.01);
    metrics.record('http.request', 'GET /tiles/:z/:x/:y.mvt', 3 + Math.random() * 20);
    metrics.record('http.request', 'GET /api/search', 15 + Math.random() * 60);
    metrics.record('route', 'explore', 450 + Math.random() * 1500);
    if (i % 3 === 0) metrics.record('route', 'fastest', 40 + Math.random() * 100);
    if (i % 5 === 0) metrics.record('route', 'roundtrip', 900 + Math.random() * 2000);
    metrics.record('graphhopper.route', 'explore.candidate', 90 + Math.random() * 400);
  }
  metrics.record('job', 'process-tracks', 50 + Math.random() * 300);
}
await metrics.flush(true);

await recordErrorEvent(db, { service: 'api', source: 'POST /api/routes/explore', error: new Error('Routing engine unreachable: connect ECONNREFUSED'), requestId: randomUUID() });
for (let i = 0; i < 24 * 60; i += 5) {
  const ts = new Date(now - i * 60_000);
  await db.query(
    `INSERT INTO system_samples VALUES (date_trunc('minute', $1::timestamptz), $2, $3, 33000000000, $4, 250000000000, true, true, $5) ON CONFLICT DO NOTHING`,
    [ts, 8 + Math.random() * 20 + (i < 60 ? 30 : 0), Math.round(14e9 + Math.random() * 2e9), Math.round(96e9 + i * 1000), Math.round(Math.random() * 3)],
  );
}
await db.query(`INSERT INTO app_state (key, value) VALUES ('worker.heartbeat', '{"demo":true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
await db.query(
  `INSERT INTO pipeline_runs (kind, status, started_at, finished_at, osm_data_date, log_tail)
   VALUES ('osm_refresh', 'succeeded', now() - interval '16 days' - interval '2 hours', now() - interval '16 days', '2026-08-31T20:21:02Z', '== download\n== graph done in 3120 s\n== tiles done in 1840 s\n== places done in 410 s\n(demo data)')`,
);
console.log(`Seeded demo data: ${batchCount} batches. Sign in as admin@demo.test / "demo password". Invite codes: ${codes.join(', ')}`);
await db.end();
