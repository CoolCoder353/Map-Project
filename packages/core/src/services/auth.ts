import { randomUUID } from 'node:crypto';
import type { AuthResponse, RegisterRequest, Role } from '@wayfinder/shared';
import { type Db, type DbClient, withTransaction } from '../db/pool.js';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../lib/passwords.js';
import { REFRESH_TOKEN_TTL_S, type TokenService, hashToken, newOpaqueToken } from '../lib/tokens.js';
import { type UserRow, findUserByEmail, findUserById, isActive, toPublicUser } from './users.js';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

async function issueTokens(
  db: DbClient,
  tokens: TokenService,
  user: UserRow,
  familyId: string,
  userAgent: string | null,
): Promise<IssuedTokens & { refreshId: string }> {
  const { token, hash } = newOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_S * 1000);
  const r = await db.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [user.id, familyId, hash, expiresAt, userAgent?.slice(0, 300) ?? null],
  );
  const accessToken = await tokens.signAccess({ sub: user.id, role: user.role });
  return { accessToken, refreshToken: token, refreshExpiresAt: expiresAt, refreshId: r.rows[0]!.id };
}

export async function register(
  db: Db,
  tokens: TokenService,
  input: RegisterRequest,
  userAgent: string | null,
): Promise<{ response: AuthResponse; tokens: IssuedTokens }> {
  const passwordHash = await hashPassword(input.password);
  return withTransaction(db, async (tx) => {
    const invite = (
      await tx.query<{ code: string; expires_at: Date | null; used_at: Date | null; revoked_at: Date | null; role_on_signup: Role }>(
        'SELECT * FROM invite_codes WHERE upper(code) = upper($1) FOR UPDATE',
        [input.inviteCode],
      )
    ).rows[0];
    if (!invite || invite.used_at || invite.revoked_at || (invite.expires_at && invite.expires_at < new Date())) {
      throw badRequest('Invite code is invalid, expired or already used');
    }
    if (await findUserByEmail(tx, input.email)) throw conflict('An account with that email already exists');
    const user = (
      await tx.query<UserRow>(
        `INSERT INTO users (email, password_hash, role, last_seen_at) VALUES ($1, $2, $3, now()) RETURNING *`,
        [input.email, passwordHash, invite.role_on_signup],
      )
    ).rows[0]!;
    await tx.query('UPDATE invite_codes SET used_by = $1, used_at = now() WHERE code = $2', [user.id, invite.code]);
    const issued = await issueTokens(tx, tokens, user, randomUUID(), userAgent);
    return { response: { accessToken: issued.accessToken, user: toPublicUser(user) }, tokens: issued };
  });
}

export async function login(
  db: Db,
  tokens: TokenService,
  email: string,
  password: string,
  userAgent: string | null,
): Promise<{ response: AuthResponse; tokens: IssuedTokens }> {
  const user = await findUserByEmail(db, email);
  if (!user) {
    await verifyPassword(await dummyPasswordHash(), password);
    throw unauthorized('Incorrect email or password');
  }
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) throw unauthorized('Incorrect email or password');
  if (user.deleted_at) throw unauthorized('Incorrect email or password');
  if (user.disabled_at) throw new AppError(403, 'account_disabled', 'This account has been disabled');
  await db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]);
  const issued = await issueTokens(db, tokens, user, randomUUID(), userAgent);
  return { response: { accessToken: issued.accessToken, user: toPublicUser(user) }, tokens: issued };
}

/**
 * Rotate a refresh token. Reusing an already-rotated token revokes its whole family
 * (a sign the token was stolen).
 */
export async function refresh(
  db: Db,
  tokens: TokenService,
  refreshToken: string,
  userAgent: string | null,
): Promise<{ response: AuthResponse; tokens: IssuedTokens }> {
  return withTransaction(db, async (tx) => {
    const row = (
      await tx.query<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null }>(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [hashToken(refreshToken)],
      )
    ).rows[0];
    if (!row) throw unauthorized('Session expired');
    if (row.revoked_at) {
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
        row.family_id,
      ]);
      throw unauthorized('Session expired');
    }
    if (row.expires_at < new Date()) throw unauthorized('Session expired');
    const user = await findUserById(tx, row.user_id);
    if (!user || !isActive(user)) throw unauthorized('Session expired');
    const issued = await issueTokens(tx, tokens, user, row.family_id, userAgent);
    await tx.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [
      row.id,
      issued.refreshId,
    ]);
    await tx.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]);
    return { response: { accessToken: issued.accessToken, user: toPublicUser(user) }, tokens: issued };
  });
}

export async function logout(db: DbClient, refreshToken: string): Promise<void> {
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    hashToken(refreshToken),
  ]);
}

export async function revokeAllSessions(db: DbClient, userId: string): Promise<number> {
  const r = await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
  return r.rowCount ?? 0;
}

export const RESET_TOKEN_TTL_S = 24 * 3600;

export async function createPasswordResetLink(
  db: DbClient,
  userId: string,
  createdBy: string | null,
  publicWebUrl: string,
): Promise<{ url: string; expiresAt: Date }> {
  const { token, hash } = newOpaqueToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_S * 1000);
  await db.query(
    'INSERT INTO password_reset_tokens (token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, $4)',
    [hash, userId, createdBy, expiresAt],
  );
  return { url: `${publicWebUrl.replace(/\/$/, '')}/reset-password?token=${token}`, expiresAt };
}

export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(db, async (tx) => {
    const row = (
      await tx.query<{ user_id: string; expires_at: Date; used_at: Date | null }>(
        'SELECT * FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE',
        [hashToken(token)],
      )
    ).rows[0];
    if (!row || row.used_at || row.expires_at < new Date()) throw badRequest('Reset link is invalid or expired');
    await tx.query('UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1', [hashToken(token)]);
    await tx.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [
      row.user_id,
      passwordHash,
    ]);
    await revokeAllSessions(tx, row.user_id);
  });
}
