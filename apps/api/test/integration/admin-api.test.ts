import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trackService } from '@wayfinder/core';
import { destination } from '@wayfinder/shared';
import { type TestApp, createTestApp, makeUser, tokenFor } from '../helpers/app.js';

let ta: TestApp;
let admin: { id: string; email: string };
let dev: { id: string; email: string };
let plain: { id: string; email: string };
let target: { id: string; email: string };
let tripId: string;

beforeAll(async () => {
  ta = await createTestApp();
  admin = await makeUser(ta.t.db, 'admin@example.com', 'admin');
  dev = await makeUser(ta.t.db, 'dev@example.com', 'dev');
  plain = await makeUser(ta.t.db, 'plain@example.com', 'user');
  target = await makeUser(ta.t.db, 'target@example.com', 'user');
  const start = Date.now() - 86_400_000;
  const points = Array.from({ length: 200 }, (_, i) => {
    const [lon, lat] = destination([149.1, -35.3], 90, i * 7);
    return { ts: start + i * 5000, lon, lat, accuracyM: 5 };
  });
  await trackService.ingestBatch(ta.t.db, ta.queue, target.id, { batchId: randomUUID(), source: 'background', points });
  await trackService.processUserTracks(ta.t.db, target.id);
  ta.queue.sent = [];
  tripId = (await ta.t.db.query('SELECT id FROM trips WHERE user_id = $1', [target.id])).rows[0].id;
});
afterAll(async () => {
  await ta?.close();
});

type Case = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: () => string; body?: () => unknown; mutation: boolean };

const cases: Case[] = [
  { method: 'GET', url: () => '/api/admin/health', mutation: false },
  { method: 'GET', url: () => '/api/admin/metrics?groupBy=hour', mutation: false },
  { method: 'GET', url: () => '/api/admin/system', mutation: false },
  { method: 'GET', url: () => '/api/admin/errors', mutation: false },
  { method: 'GET', url: () => '/api/admin/jobs', mutation: false },
  { method: 'GET', url: () => '/api/admin/pipeline/runs', mutation: false },
  { method: 'GET', url: () => '/api/admin/stats/usage', mutation: false },
  { method: 'GET', url: () => '/api/admin/users', mutation: false },
  { method: 'GET', url: () => `/api/admin/users/${target.id}`, mutation: false },
  { method: 'GET', url: () => `/api/admin/users/${target.id}/trips`, mutation: false },
  { method: 'GET', url: () => `/api/admin/users/${target.id}/trips/${tripId}`, mutation: false },
  { method: 'GET', url: () => `/api/admin/users/${target.id}/coverage?bbox=149,-35.4,149.2,-35.2&zoom=14`, mutation: false },
  { method: 'GET', url: () => `/api/admin/users/${target.id}/coverage/stats`, mutation: false },
  { method: 'GET', url: () => '/api/admin/deleted', mutation: false },
  { method: 'GET', url: () => '/api/admin/invites', mutation: false },
  { method: 'GET', url: () => '/api/admin/audit', mutation: false },
  { method: 'POST', url: () => '/api/admin/invites', body: () => ({ count: 1 }), mutation: true },
  { method: 'POST', url: () => '/api/admin/invites/NOPE-NOPE-NOPE/revoke', mutation: true },
  { method: 'PATCH', url: () => `/api/admin/users/${target.id}`, body: () => ({ disabled: false }), mutation: true },
  { method: 'POST', url: () => `/api/admin/users/${target.id}/revoke-sessions`, mutation: true },
  { method: 'POST', url: () => `/api/admin/users/${target.id}/reset-password-link`, mutation: true },
  { method: 'DELETE', url: () => `/api/admin/users/${target.id}`, body: () => ({ confirm: 'wrong' }), mutation: true },
  { method: 'POST', url: () => `/api/admin/users/${target.id}/restore`, mutation: true },
  { method: 'DELETE', url: () => `/api/admin/users/${target.id}/trips/${tripId}`, body: () => ({ confirm: 'nope' }), mutation: true },
  { method: 'POST', url: () => `/api/admin/trips/${tripId}/restore`, mutation: true },
  { method: 'POST', url: () => `/api/admin/users/${target.id}/coverage/rebuild`, mutation: true },
  { method: 'POST', url: () => '/api/admin/jobs/process-tracks/abc/retry', mutation: true },
  { method: 'POST', url: () => '/api/admin/pipeline/refresh', body: () => ({ confirm: 'no' }), mutation: true },
];

async function call(c: Case, authorization?: string) {
  return ta.app.inject({
    method: c.method,
    url: c.url(),
    headers: authorization ? { authorization } : {},
    ...(c.body ? { payload: c.body() as Record<string, unknown> } : {}),
  });
}

describe('admin authorization matrix', () => {
  it.each(cases.map((c) => [`${c.method} ${c.url.toString().replace(/^\(\) => /, '')}`, c] as const))('%s', async (_name, c) => {
    expect((await call(c)).statusCode).toBe(401);
    expect((await call(c, await tokenFor(ta, plain, 'user'))).statusCode).toBe(404);
    const devRes = await call(c, await tokenFor(ta, dev, 'dev'));
    if (c.mutation) expect(devRes.statusCode).toBe(403);
    else expect(devRes.statusCode, devRes.body).toBe(200);
    // Admins pass the role gate; some calls legitimately fail validation (400/409) or find nothing to restore (404).
    const adminRes = await call(c, await tokenFor(ta, admin, 'admin'));
    expect([401, 403, 500], adminRes.body).not.toContain(adminRes.statusCode);
    if (!c.mutation) expect(adminRes.statusCode).toBe(200);
  });

  it('a demoted admin loses access on the next request even with an unexpired token', async () => {
    const temp = await makeUser(ta.t.db, 'temp-admin@example.com', 'admin');
    const token = await tokenFor(ta, temp, 'admin');
    expect((await ta.app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: token } })).statusCode).toBe(200);
    const demote = await ta.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${temp.id}`,
      headers: { authorization: await tokenFor(ta, admin, 'admin') },
      payload: { role: 'user', confirm: temp.email },
    });
    expect(demote.statusCode).toBe(200);
    expect((await ta.app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: token } })).statusCode).toBe(404);
  });

  it('inspection is audited exactly once per view', async () => {
    const before = Number((await ta.t.db.query("SELECT count(*) AS n FROM audit_log WHERE action = 'user.view_trips'")).rows[0].n);
    await ta.app.inject({ method: 'GET', url: `/api/admin/users/${target.id}/trips`, headers: { authorization: await tokenFor(ta, dev, 'dev') } });
    const rows = (await ta.t.db.query("SELECT actor_id, target_id FROM audit_log WHERE action = 'user.view_trips' ORDER BY id DESC")).rows;
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toEqual({ actor_id: dev.id, target_id: target.id });
  });
});

describe('dashboard flow (API level)', () => {
  it('invite → register → promote to dev → dev read-only → admin deletes & restores a trip, all audited', async () => {
    ta.queue.sent = [];
    const adminAuth = { authorization: await tokenFor(ta, admin, 'admin') };
    const inv = await ta.app.inject({ method: 'POST', url: '/api/admin/invites', headers: adminAuth, payload: { count: 1, note: 'for Sam' } });
    expect(inv.statusCode).toBe(201);
    const code = inv.json().codes[0];
    const reg = await ta.app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: code, email: 'sam@example.com', password: 'sam password 1' } });
    expect(reg.statusCode).toBe(201);
    const samId = reg.json().user.id;
    const invites = (await ta.app.inject({ method: 'GET', url: '/api/admin/invites?status=used', headers: adminAuth })).json().items;
    expect(invites.find((i: { code: string }) => i.code === code)).toMatchObject({ usedByEmail: 'sam@example.com', note: 'for Sam' });

    const promote = await ta.app.inject({ method: 'PATCH', url: `/api/admin/users/${samId}`, headers: adminAuth, payload: { role: 'dev', confirm: 'sam@example.com' } });
    expect(promote.json().role).toBe('dev');

    const login = await ta.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sam@example.com', password: 'sam password 1' } });
    const samAuth = { authorization: `Bearer ${login.json().accessToken}` };
    expect((await ta.app.inject({ method: 'GET', url: '/api/admin/users', headers: samAuth })).statusCode).toBe(200);
    expect((await ta.app.inject({ method: 'POST', url: '/api/admin/invites', headers: samAuth, payload: {} })).statusCode).toBe(403);

    const del = await ta.app.inject({ method: 'DELETE', url: `/api/admin/users/${target.id}/trips/${tripId}`, headers: adminAuth, payload: { confirm: 'DELETE' } });
    expect(del.statusCode).toBe(200);
    expect(ta.queue.take('rebuild-coverage')).toHaveLength(1);
    const deleted = (await ta.app.inject({ method: 'GET', url: '/api/admin/deleted', headers: adminAuth })).json();
    expect(deleted.trips.map((t: { id: string }) => t.id)).toContain(tripId);
    const restore = await ta.app.inject({ method: 'POST', url: `/api/admin/trips/${tripId}/restore`, headers: adminAuth });
    expect(restore.statusCode).toBe(200);

    const audit = (await ta.app.inject({ method: 'GET', url: '/api/admin/audit?limit=50', headers: adminAuth })).json().items.map((a: { action: string }) => a.action);
    for (const action of ['invite.create', 'user.role_change', 'trip.delete', 'trip.restore']) expect(audit).toContain(action);
  });

  it('pipeline refresh requires REFRESH confirmation and queues one run', async () => {
    const adminAuth = { authorization: await tokenFor(ta, admin, 'admin') };
    const ok = await ta.app.inject({ method: 'POST', url: '/api/admin/pipeline/refresh', headers: adminAuth, payload: { confirm: 'REFRESH' } });
    expect(ok.statusCode).toBe(202);
    const busy = await ta.app.inject({ method: 'POST', url: '/api/admin/pipeline/refresh', headers: adminAuth, payload: { confirm: 'REFRESH' } });
    expect(busy.statusCode).toBe(409);
    expect(ta.queue.take('osm-refresh')).toHaveLength(1);
  });
});
