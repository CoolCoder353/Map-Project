import { DEFAULT_SETTINGS, type PublicUser, type Role, type UserSettings } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  settings: Partial<UserSettings>;
  created_at: Date;
  last_seen_at: Date | null;
  disabled_at: Date | null;
  deleted_at: Date | null;
  password_changed_at: Date;
}

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  createdAt: u.created_at.toISOString(),
  settings: { ...DEFAULT_SETTINGS, ...u.settings },
});

export async function findUserByEmail(db: DbClient, email: string): Promise<UserRow | null> {
  const r = await db.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return r.rows[0] ?? null;
}

export async function findUserById(db: DbClient, id: string): Promise<UserRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export const isActive = (u: UserRow) => !u.disabled_at && !u.deleted_at;

export async function updateSettings(db: DbClient, userId: string, patch: Partial<UserSettings>): Promise<UserRow> {
  const r = await db.query<UserRow>(
    `UPDATE users SET settings = settings || $2::jsonb WHERE id = $1 RETURNING *`,
    [userId, JSON.stringify(patch)],
  );
  return r.rows[0]!;
}

export async function countActiveAdmins(db: DbClient, excludingUserId?: string): Promise<number> {
  const r = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM users
     WHERE role = 'admin' AND disabled_at IS NULL AND deleted_at IS NULL AND id <> coalesce($1::uuid, '00000000-0000-0000-0000-000000000000')`,
    [excludingUserId ?? null],
  );
  return Number(r.rows[0]!.n);
}
