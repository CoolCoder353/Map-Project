import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as auth from '../../src/services/auth.js';
import * as invites from '../../src/services/invites.js';
import { TokenService } from '../../src/lib/tokens.js';
import { hashPassword } from '../../src/lib/passwords.js';
import { type TestDb, createTestDb } from '../helpers/db.js';

let t: TestDb;
const tokens = new TokenService('x'.repeat(40));

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

async function invite(role: 'user' | 'dev' | 'admin' = 'user', expiresInDays: number | null = 14) {
  const [code] = await invites.createInvites(t.db, { count: 1, expiresInDays, note: null, roleOnSignup: role, createdBy: null });
  return code!;
}

describe('auth service', () => {
  it('registers with a valid invite, applying role_on_signup, and consumes the code', async () => {
    const code = await invite('dev');
    const { response, tokens: issued } = await auth.register(t.db, tokens, { inviteCode: code, email: 'dev@example.com', password: 'long enough pw' }, 'vitest');
    expect(response.user.role).toBe('dev');
    expect(response.user.settings.trackingEnabled).toBe(false);
    expect((await tokens.verifyAccess(response.accessToken)).sub).toBe(response.user.id);
    expect(issued.refreshToken.length).toBeGreaterThan(20);

    await expect(
      auth.register(t.db, tokens, { inviteCode: code, email: 'other@example.com', password: 'long enough pw' }, null),
    ).rejects.toMatchObject({ statusCode: 400 });
    const [listed] = (await invites.listInvites(t.db)).filter((i) => i.code === code);
    expect(listed!.status).toBe('used');
    expect(listed!.usedByEmail).toBe('dev@example.com');
  });

  it('rejects expired, revoked and unknown codes and duplicate emails', async () => {
    const expired = await invite();
    await t.db.query("UPDATE invite_codes SET expires_at = now() - interval '1 day' WHERE code = $1", [expired]);
    const revoked = await invite();
    expect(await invites.revokeInvite(t.db, revoked)).toBe(true);
    for (const code of [expired, revoked, 'NOPE-NOPE-NOPE']) {
      await expect(
        auth.register(t.db, tokens, { inviteCode: code, email: `x${code}@example.com`, password: 'long enough pw' }, null),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    const code = await invite();
    await expect(
      auth.register(t.db, tokens, { inviteCode: code, email: 'DEV@example.com', password: 'long enough pw' }, null),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('logs in, rotates refresh tokens and revokes the family on reuse', async () => {
    const login = await auth.login(t.db, tokens, 'dev@example.com', 'long enough pw', null);
    const first = login.tokens.refreshToken;
    const rotated = await auth.refresh(t.db, tokens, first, null);
    expect(rotated.tokens.refreshToken).not.toBe(first);
    // Reusing the old token: rejected, and the newer token in the same family is revoked too.
    await expect(auth.refresh(t.db, tokens, first, null)).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.refresh(t.db, tokens, rotated.tokens.refreshToken, null)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects bad passwords, disabled and deleted accounts', async () => {
    await expect(auth.login(t.db, tokens, 'dev@example.com', 'wrong password', null)).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.login(t.db, tokens, 'nobody@example.com', 'whatever', null)).rejects.toMatchObject({ statusCode: 401 });
    const hash = await hashPassword('another long pw');
    await t.db.query("INSERT INTO users (email, password_hash, disabled_at) VALUES ('off@example.com', $1, now())", [hash]);
    await t.db.query("INSERT INTO users (email, password_hash, deleted_at) VALUES ('gone@example.com', $1, now())", [hash]);
    await expect(auth.login(t.db, tokens, 'off@example.com', 'another long pw', null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(auth.login(t.db, tokens, 'gone@example.com', 'another long pw', null)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('resets a password via a one-time link and revokes sessions', async () => {
    const user = (await t.db.query("SELECT id FROM users WHERE email = 'dev@example.com'")).rows[0];
    const session = await auth.login(t.db, tokens, 'dev@example.com', 'long enough pw', null);
    const link = await auth.createPasswordResetLink(t.db, user.id, null, 'https://maps.example');
    const token = new URL(link.url).searchParams.get('token')!;
    await auth.resetPassword(t.db, token, 'brand new password');
    await expect(auth.resetPassword(t.db, token, 'second attempt pw')).rejects.toMatchObject({ statusCode: 400 });
    await expect(auth.refresh(t.db, tokens, session.tokens.refreshToken, null)).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.login(t.db, tokens, 'dev@example.com', 'brand new password', null)).resolves.toBeTruthy();
  });
});
