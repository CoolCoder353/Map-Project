import type { Invite, Role } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { newInviteCode } from '../lib/tokens.js';

interface InviteRow {
  code: string;
  note: string | null;
  role_on_signup: Role;
  created_at: Date;
  created_by_email: string | null;
  expires_at: Date | null;
  used_at: Date | null;
  used_by_email: string | null;
  revoked_at: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toInvite(r: InviteRow): Invite {
  const status = r.revoked_at
    ? 'revoked'
    : r.used_at
      ? 'used'
      : r.expires_at && r.expires_at < new Date()
        ? 'expired'
        : 'unused';
  return {
    code: r.code,
    note: r.note,
    roleOnSignup: r.role_on_signup,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by_email,
    expiresAt: iso(r.expires_at),
    usedAt: iso(r.used_at),
    usedByEmail: r.used_by_email,
    revokedAt: iso(r.revoked_at),
    status,
  };
}

export async function createInvites(
  db: DbClient,
  opts: { count: number; expiresInDays: number | null; note: string | null; roleOnSignup: Role; createdBy: string | null },
): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const code = newInviteCode();
    await db.query(
      `INSERT INTO invite_codes (code, created_by, expires_at, note, role_on_signup)
       VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END, $4, $5)`,
      [code, opts.createdBy, opts.expiresInDays, opts.note, opts.roleOnSignup],
    );
    codes.push(code);
  }
  return codes;
}

export async function listInvites(db: DbClient, status?: Invite['status']): Promise<Invite[]> {
  const r = await db.query<InviteRow>(
    `SELECT i.*, cu.email AS created_by_email, uu.email AS used_by_email
     FROM invite_codes i
     LEFT JOIN users cu ON cu.id = i.created_by
     LEFT JOIN users uu ON uu.id = i.used_by
     ORDER BY i.created_at DESC
     LIMIT 1000`,
  );
  const all = r.rows.map(toInvite);
  return status ? all.filter((i) => i.status === status) : all;
}

export async function revokeInvite(db: DbClient, code: string): Promise<boolean> {
  const r = await db.query(
    'UPDATE invite_codes SET revoked_at = now() WHERE code = $1 AND revoked_at IS NULL AND used_at IS NULL',
    [code],
  );
  return (r.rowCount ?? 0) > 0;
}
