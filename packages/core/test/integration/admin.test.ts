import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as admin from '../../src/services/admin.js';
import * as auth from '../../src/services/auth.js';
import { TokenService } from '../../src/lib/tokens.js';
import { type TestDb, createTestDb } from '../helpers/db.js';
import { makeUser } from '../helpers/users.js';

let t: TestDb;
const tokens = new TokenService('y'.repeat(40));

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

const auditCount = async () => Number((await t.db.query('SELECT count(*) AS n FROM audit_log')).rows[0].n);

describe('admin service guardrails', () => {
  it('changes roles with confirmation, audits, and revokes sessions', async () => {
    const boss = await makeUser(t.db, 'boss@example.com', 'admin');
    const sam = await makeUser(t.db, 'sam@example.com');
    const session = await auth.login(t.db, tokens, sam.email, 'test password 123', null);
    const actor = { id: boss.id, ip: '10.0.0.1' };

    await expect(admin.updateUserAsAdmin(t.db, actor, sam.id, { role: 'dev' })).rejects.toMatchObject({ code: 'confirmation_required' });
    const n0 = await auditCount();
    const updated = await admin.updateUserAsAdmin(t.db, actor, sam.id, { role: 'dev', confirm: 'SAM@example.com' });
    expect(updated.role).toBe('dev');
    expect(await auditCount()).toBe(n0 + 1);
    const [entry] = await admin.listAudit(t.db, { targetId: sam.id, limit: 10 });
    expect(entry).toMatchObject({ action: 'user.role_change', actorEmail: 'boss@example.com', details: { from: 'user', to: 'dev' }, ip: '10.0.0.1' });
    await expect(auth.refresh(t.db, tokens, session.tokens.refreshToken, null)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('protects the last admin and forbids self-changes', async () => {
    const boss = (await t.db.query("SELECT id FROM users WHERE email = 'boss@example.com'")).rows[0];
    const other = await makeUser(t.db, 'second@example.com', 'admin');
    const actor = { id: other.id, ip: null };
    await expect(admin.updateUserAsAdmin(t.db, { id: boss.id, ip: null }, boss.id, { role: 'user', confirm: 'boss@example.com' })).rejects.toMatchObject({ statusCode: 403 });
    // Demote boss: allowed while `second` remains an admin.
    await admin.updateUserAsAdmin(t.db, actor, boss.id, { role: 'user', confirm: 'boss@example.com' });
    // Now `second` is the only admin: nobody may demote, disable or delete them.
    const dev = await makeUser(t.db, 'devops@example.com', 'admin');
    await admin.updateUserAsAdmin(t.db, actor, dev.id, { role: 'dev', confirm: 'devops@example.com' });
    await expect(admin.softDeleteUser(t.db, actor, other.id, 'second@example.com')).rejects.toMatchObject({ statusCode: 403 });
    // Promote boss back so another admin exists, then boss can't remove second if that would leave zero... it leaves boss.
    await admin.updateUserAsAdmin(t.db, actor, boss.id, { role: 'admin', confirm: 'boss@example.com' });
    await admin.updateUserAsAdmin(t.db, { id: boss.id, ip: null }, other.id, { disabled: true });
    await expect(
      admin.updateUserAsAdmin(t.db, { id: other.id, ip: null }, boss.id, { role: 'user', confirm: 'boss@example.com' }),
    ).rejects.toMatchObject({ code: 'last_admin' });
  });

  it('soft-deletes users (login blocked), restores within the window, purges after', async () => {
    const boss = (await t.db.query("SELECT id FROM users WHERE email = 'boss@example.com'")).rows[0];
    const victim = await makeUser(t.db, 'victim@example.com');
    const actor = { id: boss.id, ip: null };
    await expect(admin.softDeleteUser(t.db, actor, victim.id, 'wrong@example.com')).rejects.toMatchObject({ code: 'confirmation_required' });
    await admin.softDeleteUser(t.db, actor, victim.id, 'victim@example.com');
    await expect(auth.login(t.db, tokens, victim.email, 'test password 123', null)).rejects.toMatchObject({ statusCode: 401 });
    expect((await admin.listDeleted(t.db)).users.map((u) => u.email)).toContain('victim@example.com');
    await admin.restoreUser(t.db, actor, victim.id);
    await expect(auth.login(t.db, tokens, victim.email, 'test password 123', null)).resolves.toBeTruthy();

    await admin.softDeleteUser(t.db, actor, victim.id, 'victim@example.com');
    await admin.purgeDeleted(t.db, new Date(Date.now() + 8 * 86_400_000));
    expect((await t.db.query('SELECT 1 FROM users WHERE id = $1', [victim.id])).rowCount).toBe(0);
    // audit rows survive the purge
    expect((await admin.listAudit(t.db, { targetId: victim.id, limit: 10 })).length).toBeGreaterThanOrEqual(3);
  });

  it('lists users with filters and counts', async () => {
    const all = await admin.listUsers(t.db, { status: 'all', limit: 50, offset: 0 });
    expect(all.total).toBeGreaterThanOrEqual(4);
    const disabled = await admin.listUsers(t.db, { status: 'disabled', limit: 50, offset: 0 });
    expect(disabled.items.map((u) => u.email)).toEqual(['second@example.com']);
    const search = await admin.listUsers(t.db, { q: 'boss', status: 'all', limit: 50, offset: 0 });
    expect(search.items).toHaveLength(1);
    expect(search.items[0]!.tripCount).toBe(0);
  });

  it('aggregates metrics and usage', async () => {
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / 60000) * 60000);
    const hist = Array(64).fill(0);
    hist[20] = 10;
    await t.db.query(
      `INSERT INTO metrics_minute (bucket_start, metric, label, count, error_count, sum_ms, max_ms, histogram)
       VALUES ($1, 'http.request', 'GET /x', 10, 1, 100, 50, $2), ($3, 'http.request', 'GET /x', 5, 0, 50, 20, $2)`,
      [minute, hist, new Date(minute.getTime() - 60000)],
    );
    const points = await admin.queryMetrics(t.db, { metric: 'http', groupBy: 'hour' });
    const total = points.reduce((n, p) => n + p.count, 0);
    expect(total).toBe(15);
    expect(points[0]!.p95Ms).toBeGreaterThan(0);
    const usage = await admin.usageStats(t.db);
    expect(usage.totalUsers).toBeGreaterThanOrEqual(4);
    await admin.maintainMetrics(t.db);
  });
});
