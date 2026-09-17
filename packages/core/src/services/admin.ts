import {
  type AdminUser,
  type AuditEntry,
  type MetricPoint,
  type Role,
  SOFT_DELETE_RETENTION_DAYS,
  type UsageStats,
  DEFAULT_SETTINGS,
} from '@wayfinder/shared';
import { type Db, type DbClient, withTransaction } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { mergeHistograms, percentileFromHistogram } from '../lib/metrics.js';
import { revokeAllSessions } from './auth.js';
import { type UserRow, countActiveAdmins, findUserById } from './users.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

interface AdminUserRow extends UserRow {
  trip_count: string;
  cell_count: string;
}

const toAdminUser = (r: AdminUserRow): AdminUser => ({
  id: r.id,
  email: r.email,
  role: r.role,
  createdAt: r.created_at.toISOString(),
  lastSeenAt: iso(r.last_seen_at),
  disabledAt: iso(r.disabled_at),
  deletedAt: iso(r.deleted_at),
  tripCount: Number(r.trip_count),
  cellCount: Number(r.cell_count),
  settings: { ...DEFAULT_SETTINGS, ...r.settings },
});

const USER_SELECT = `SELECT u.*,
  (SELECT count(*) FROM trips t WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS trip_count,
  (SELECT count(*) FROM visited_cells v WHERE v.user_id = u.id) AS cell_count
  FROM users u`;

export async function listUsers(
  db: DbClient,
  q: { q?: string | undefined; status: 'active' | 'disabled' | 'deleted' | 'all'; limit: number; offset: number },
): Promise<{ items: AdminUser[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`u.email ILIKE $${params.length}`);
  }
  if (q.status === 'active') where.push('u.disabled_at IS NULL AND u.deleted_at IS NULL');
  if (q.status === 'disabled') where.push('u.disabled_at IS NOT NULL AND u.deleted_at IS NULL');
  if (q.status === 'deleted') where.push('u.deleted_at IS NOT NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(
    (await db.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${whereSql}`, params)).rows[0]!.n,
  );
  const rows = (
    await db.query<AdminUserRow>(
      `${USER_SELECT} ${whereSql} ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, q.offset],
    )
  ).rows;
  return { items: rows.map(toAdminUser), total };
}

export async function getAdminUser(db: DbClient, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('User not found');
  const row = (await db.query<AdminUserRow>(`${USER_SELECT} WHERE u.id = $1`, [id])).rows[0];
  if (!row) throw notFound('User not found');
  const sessions = (
    await db.query<{ id: string; created_at: Date; expires_at: Date; revoked_at: Date | null; user_agent: string | null }>(
      'SELECT id, created_at, expires_at, revoked_at, user_agent FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [id],
    )
  ).rows;
  return {
    ...toAdminUser(row),
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
      revokedAt: iso(s.revoked_at),
      userAgent: s.user_agent,
    })),
  };
}

export interface ActorInfo {
  id: string;
  ip: string | null;
}

function requireConfirm(target: UserRow, confirm: string | undefined) {
  if (!confirm || confirm.trim().toLowerCase() !== target.email.toLowerCase()) {
    throw new AppError(400, 'confirmation_required', "Type the user's email address to confirm");
  }
}

async function ensureNotLastAdmin(db: DbClient, target: UserRow) {
  if (target.role === 'admin' && !target.disabled_at && !target.deleted_at && (await countActiveAdmins(db, target.id)) === 0) {
    throw new AppError(409, 'last_admin', 'Cannot remove the last active admin');
  }
}

export async function updateUserAsAdmin(
  db: Db,
  actor: ActorInfo,
  userId: string,
  patch: { role?: Role | undefined; disabled?: boolean | undefined; confirm?: string | undefined },
): Promise<AdminUser> {
  await withTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('admin-roles'))");
    const target = await findUserById(tx, userId);
    if (!target || target.deleted_at) throw notFound('User not found');
    if (target.id === actor.id) throw forbidden('You cannot change your own role or status');

    if (patch.role !== undefined && patch.role !== target.role) {
      requireConfirm(target, patch.confirm);
      if (patch.role !== 'admin') await ensureNotLastAdmin(tx, target);
      await tx.query('UPDATE users SET role = $2 WHERE id = $1', [target.id, patch.role]);
      await audit(tx, {
        actorId: actor.id,
        action: 'user.role_change',
        targetType: 'user',
        targetId: target.id,
        details: { from: target.role, to: patch.role },
        ip: actor.ip,
      });
      // Tokens carry the role; force a fresh sign-in.
      await revokeAllSessions(tx, target.id);
    }
    if (patch.disabled !== undefined && patch.disabled !== Boolean(target.disabled_at)) {
      if (patch.disabled) {
        await ensureNotLastAdmin(tx, target);
        await tx.query('UPDATE users SET disabled_at = now() WHERE id = $1', [target.id]);
        await revokeAllSessions(tx, target.id);
      } else {
        await tx.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [target.id]);
      }
      await audit(tx, {
        actorId: actor.id,
        action: patch.disabled ? 'user.disable' : 'user.enable',
        targetType: 'user',
        targetId: target.id,
        ip: actor.ip,
      });
    }
  });
  const updated = await getAdminUser(db, userId);
  const { sessions: _sessions, ...user } = updated;
  return user;
}

export async function softDeleteUser(db: Db, actor: ActorInfo | null, userId: string, confirm: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('admin-roles'))");
    const target = await findUserById(tx, userId);
    if (!target || target.deleted_at) throw notFound('User not found');
    if (actor && target.id === actor.id) throw forbidden('You cannot delete your own account from the dashboard');
    requireConfirm(target, confirm);
    await ensureNotLastAdmin(tx, target);
    await tx.query('UPDATE users SET deleted_at = now() WHERE id = $1', [target.id]);
    await revokeAllSessions(tx, target.id);
    await audit(tx, {
      actorId: actor?.id ?? target.id,
      action: actor ? 'user.delete' : 'user.self_delete',
      targetType: 'user',
      targetId: target.id,
      ip: actor?.ip ?? null,
    });
  });
}

export async function restoreUser(db: Db, actor: ActorInfo, userId: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const r = await tx.query(
      `UPDATE users SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_at > now() - make_interval(days => $2)`,
      [userId, SOFT_DELETE_RETENTION_DAYS],
    );
    if (r.rowCount === 0) throw notFound('No restorable user with that id');
    await audit(tx, { actorId: actor.id, action: 'user.restore', targetType: 'user', targetId: userId, ip: actor.ip });
  });
}

export async function listDeleted(db: DbClient) {
  const users = (
    await db.query<{ id: string; email: string; deleted_at: Date }>(
      'SELECT id, email, deleted_at FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC',
    )
  ).rows;
  const trips = (
    await db.query<{ id: string; user_id: string; email: string; started_at: Date; deleted_at: Date }>(
      `SELECT t.id, t.user_id, u.email, t.started_at, t.deleted_at FROM trips t JOIN users u ON u.id = t.user_id
       WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC LIMIT 500`,
    )
  ).rows;
  const purgeAt = (d: Date) => new Date(d.getTime() + SOFT_DELETE_RETENTION_DAYS * 86_400_000).toISOString();
  return {
    users: users.map((u) => ({ id: u.id, email: u.email, deletedAt: u.deleted_at.toISOString(), purgeAt: purgeAt(u.deleted_at) })),
    trips: trips.map((t) => ({
      id: t.id,
      userId: t.user_id,
      userEmail: t.email,
      startedAt: t.started_at.toISOString(),
      deletedAt: t.deleted_at.toISOString(),
      purgeAt: purgeAt(t.deleted_at),
    })),
  };
}

/** Hard-delete users and trips soft-deleted longer than the retention window. */
export async function purgeDeleted(db: DbClient, now = new Date()): Promise<{ users: number; trips: number }> {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * 86_400_000);
  const trips = await db.query('DELETE FROM trips WHERE deleted_at IS NOT NULL AND deleted_at <= $1', [cutoff]);
  const users = await db.query('DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= $1', [cutoff]);
  return { users: users.rowCount ?? 0, trips: trips.rowCount ?? 0 };
}

export async function listAudit(
  db: DbClient,
  q: { actorId?: string | undefined; targetId?: string | undefined; action?: string | undefined; limit: number; before?: string | undefined },
): Promise<AuditEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (q.actorId) add('a.actor_id::text = ?', q.actorId);
  if (q.targetId) add('a.target_id = ?', q.targetId);
  if (q.action) add('a.action LIKE ?', `${q.action}%`);
  if (q.before) add('a.id < ?', Number(q.before));
  params.push(q.limit);
  const rows = (
    await db.query<{
      id: string;
      created_at: Date;
      actor_id: string | null;
      actor_email: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      details: Record<string, unknown>;
      ip: string | null;
    }>(
      `SELECT a.*, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT $${params.length}`,
      params,
    )
  ).rows;
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: r.created_at.toISOString(),
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    ip: r.ip,
  }));
}

export async function listErrorGroups(
  db: DbClient,
  q: { service?: string | undefined; source?: string | undefined; limit: number },
) {
  const rows = (
    await db.query<{
      id: string;
      created_at: Date;
      service: string;
      source: string;
      message: string;
      stack: string | null;
      request_id: string | null;
      user_id: string | null;
    }>(
      `SELECT * FROM error_events
       WHERE created_at > now() - interval '30 days'
         AND ($1::text IS NULL OR service = $1) AND ($2::text IS NULL OR source = $2)
       ORDER BY created_at DESC LIMIT 5000`,
      [q.service ?? null, q.source ?? null],
    )
  ).rows;
  const groups = new Map<string, { count: number; latest: (typeof rows)[number] }>();
  for (const r of rows) {
    const key = `${r.service}|${r.source}|${r.message}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { count: 1, latest: r });
  }
  return [...groups.values()].slice(0, q.limit).map(({ count, latest }) => ({
    message: latest.message,
    service: latest.service,
    source: latest.source,
    count,
    lastSeen: latest.created_at.toISOString(),
    latest: {
      id: String(latest.id),
      createdAt: latest.created_at.toISOString(),
      service: latest.service,
      source: latest.source,
      message: latest.message,
      stack: latest.stack,
      requestId: latest.request_id,
      userId: latest.user_id,
    },
  }));
}

export async function queryMetrics(
  db: DbClient,
  q: { metric?: string | undefined; from?: string | undefined; to?: string | undefined; groupBy: 'minute' | 'hour' | 'day' },
): Promise<MetricPoint[]> {
  const to = q.to ? new Date(q.to) : new Date();
  const defaultSpan = { minute: 3 * 3600_000, hour: 2 * 86_400_000, day: 30 * 86_400_000 }[q.groupBy];
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - defaultSpan);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Invalid time range');
  const useDaily = q.groupBy === 'day' && to.getTime() - from.getTime() > 30 * 86_400_000;
  const rows = (
    await db.query<{
      bucket: Date;
      metric: string;
      label: string;
      count: number;
      error_count: number;
      max_ms: number | null;
      histogram: number[];
    }>(
      useDaily
        ? `SELECT day::timestamptz AS bucket, metric, label, count, error_count, max_ms, histogram FROM metrics_daily
           WHERE day >= $1::date AND day <= $2::date AND ($3::text IS NULL OR metric LIKE $3 || '%')`
        : `SELECT date_trunc('${q.groupBy}', bucket_start) AS bucket, metric, label, count, error_count, max_ms, histogram
           FROM metrics_minute
           WHERE bucket_start >= $1 AND bucket_start <= $2 AND ($3::text IS NULL OR metric LIKE $3 || '%')`,
      [from, to, q.metric ?? null],
    )
  ).rows;
  const merged = new Map<string, { bucket: Date; metric: string; label: string; count: number; err: number; max: number; hist: number[] }>();
  for (const r of rows) {
    const key = `${r.bucket.toISOString()}|${r.metric}|${r.label}`;
    const m = merged.get(key);
    if (!m) merged.set(key, { bucket: r.bucket, metric: r.metric, label: r.label, count: r.count, err: r.error_count, max: r.max_ms ?? 0, hist: r.histogram });
    else {
      m.count += r.count;
      m.err += r.error_count;
      m.max = Math.max(m.max, r.max_ms ?? 0);
      m.hist = mergeHistograms(m.hist, r.histogram);
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.bucket.getTime() - b.bucket.getTime())
    .map((m) => ({
      bucket: m.bucket.toISOString(),
      metric: m.metric,
      label: m.label,
      count: m.count,
      errorCount: m.err,
      p50Ms: percentileFromHistogram(m.hist, 0.5),
      p95Ms: percentileFromHistogram(m.hist, 0.95),
      maxMs: m.max,
    }));
}

/** Roll finished days of minute metrics into metrics_daily and apply retention. */
export async function maintainMetrics(db: DbClient): Promise<void> {
  const rows = (
    await db.query<{ day: Date; metric: string; label: string; count: string; error_count: string; sum_ms: number; max_ms: number; histograms: number[][] }>(
      `SELECT date_trunc('day', bucket_start) AS day, metric, label, sum(count) AS count, sum(error_count) AS error_count,
              sum(sum_ms) AS sum_ms, max(max_ms) AS max_ms, array_agg(histogram) AS histograms
       FROM metrics_minute
       WHERE bucket_start < date_trunc('day', now()) AND bucket_start >= date_trunc('day', now()) - interval '3 days'
       GROUP BY 1, 2, 3`,
    )
  ).rows;
  for (const r of rows) {
    const hist = r.histograms.reduce((acc, h) => mergeHistograms(acc, h), [] as number[]);
    await db.query(
      `INSERT INTO metrics_daily (day, metric, label, count, error_count, sum_ms, p50_ms, p95_ms, max_ms, histogram)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (day, metric, label) DO UPDATE SET count = EXCLUDED.count, error_count = EXCLUDED.error_count,
         sum_ms = EXCLUDED.sum_ms, p50_ms = EXCLUDED.p50_ms, p95_ms = EXCLUDED.p95_ms, max_ms = EXCLUDED.max_ms,
         histogram = EXCLUDED.histogram`,
      [r.day, r.metric, r.label, Number(r.count), Number(r.error_count), r.sum_ms, percentileFromHistogram(hist, 0.5), percentileFromHistogram(hist, 0.95), r.max_ms, hist],
    );
  }
  await db.query("DELETE FROM metrics_minute WHERE bucket_start < now() - interval '30 days'");
  await db.query("DELETE FROM metrics_daily WHERE day < now() - interval '365 days'");
  await db.query("DELETE FROM error_events WHERE created_at < now() - interval '30 days'");
  await db.query("DELETE FROM system_samples WHERE ts < now() - interval '30 days'");
  await db.query("DELETE FROM route_requests WHERE created_at < now() - interval '365 days'");
}

export async function usageStats(db: DbClient): Promise<UsageStats> {
  const one = async <T>(sql: string) => (await db.query<T & Record<string, unknown>>(sql)).rows;
  const [totals] = await one<{ total: string; dau: string; wau: string; opt_in: string; active: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE last_seen_at > now() - interval '1 day') AS dau,
            count(*) FILTER (WHERE last_seen_at > now() - interval '7 days') AS wau,
            count(*) FILTER (WHERE (settings->>'trackingEnabled')::boolean) AS opt_in,
            count(*) AS active
     FROM users WHERE deleted_at IS NULL`,
  );
  const signups = await one<{ day: Date; count: string }>(
    `SELECT date_trunc('day', created_at) AS day, count(*) AS count FROM users
     WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`,
  );
  const trips = await one<{ day: Date; car: string; foot: string }>(
    `SELECT date_trunc('day', started_at) AS day, count(*) FILTER (WHERE mode = 'car') AS car,
            count(*) FILTER (WHERE mode = 'foot') AS foot
     FROM trips WHERE started_at > now() - interval '30 days' AND deleted_at IS NULL GROUP BY 1 ORDER BY 1`,
  );
  const routes = await one<{ kind: string; count: string }>(
    `SELECT kind, count(*) AS count FROM route_requests WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`,
  );
  const [cells] = await one<{ total: string; week: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE first_visited_at > now() - interval '7 days') AS week FROM visited_cells`,
  );
  const perCellKm2 = 0.105;
  const total = Number(totals!.total);
  return {
    totalUsers: total,
    signupsByDay: signups.map((s) => ({ day: s.day.toISOString().slice(0, 10), count: Number(s.count) })),
    dau: Number(totals!.dau),
    wau: Number(totals!.wau),
    tripsByDay: trips.map((t) => ({ day: t.day.toISOString().slice(0, 10), car: Number(t.car), foot: Number(t.foot) })),
    routesByKind: routes.map((r) => ({ kind: r.kind, count: Number(r.count) })),
    trackingOptInPct: total ? Math.round((Number(totals!.opt_in) / total) * 1000) / 10 : 0,
    exploredKm2Total: Math.round(Number(cells!.total) * perCellKm2 * 10) / 10,
    exploredKm2Week: Math.round(Number(cells!.week) * perCellKm2 * 10) / 10,
  };
}

export async function getAppState<T>(db: DbClient, key: string): Promise<{ value: T; updatedAt: Date } | null> {
  const r = await db.query<{ value: T; updated_at: Date }>('SELECT value, updated_at FROM app_state WHERE key = $1', [key]);
  return r.rows[0] ? { value: r.rows[0].value, updatedAt: r.rows[0].updated_at } : null;
}

export async function setAppState(db: DbClient, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
