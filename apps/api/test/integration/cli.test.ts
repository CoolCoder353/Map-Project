import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyPassword } from '@wayfinder/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USAGE, runCommand } from '../../src/cli-commands.js';
import { type TestDb, createTestDb } from '../../../../packages/core/test/helpers/db.js';
import { makeUser } from '../../../../packages/core/test/helpers/users.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

async function run(command: string | undefined, ...args: string[]) {
  const out: string[] = [];
  const code = await runCommand(t.db, command, args, (l) => out.push(l), 'https://maps.test');
  return { code, out };
}

const auditActions = async () => (await t.db.query<{ action: string; details: Record<string, unknown> }>('SELECT action, details FROM audit_log ORDER BY created_at')).rows;

describe('admin CLI', () => {
  it('migrate reports an up-to-date database', async () => {
    expect(await run('migrate')).toEqual({ code: 0, out: ['Database is up to date'] });
  });

  it('bootstrap-admin creates an admin with a generated password, audited', async () => {
    const { code, out } = await run('bootstrap-admin', 'First@Example.test');
    expect(code).toBe(0);
    const password = out[0]!.match(/with password: (\S+)$/)![1]!;
    expect(out[1]).toMatch(/Change it after signing in/);
    const u = await t.db.query<{ role: string; password_hash: string; email: string }>("SELECT role, password_hash, email FROM users WHERE email = 'first@example.test'");
    expect(u.rows[0]!.role).toBe('admin');
    expect(await verifyPassword(u.rows[0]!.password_hash, password)).toBe(true);
    expect((await auditActions()).at(-1)).toMatchObject({ action: 'user.create_admin', details: { via: 'cli' } });
  });

  it('bootstrap-admin uses a given password and doesn’t print it', async () => {
    const { out } = await run('bootstrap-admin', 'second@example.test', 'a long enough password');
    expect(out).toEqual(['Created admin second@example.test']);
  });

  it('bootstrap-admin refuses a short password', async () => {
    await expect(run('bootstrap-admin', 'third@example.test', 'short')).rejects.toThrow(/at least 10 characters/);
  });

  it('bootstrap-admin promotes, re-enables and restores an existing account', async () => {
    const u = await makeUser(t.db, 'someone@example.test', 'user');
    await t.db.query('UPDATE users SET disabled_at = now(), deleted_at = now() WHERE id = $1', [u.id]);
    expect((await run('bootstrap-admin', 'someone@example.test')).out).toEqual(['Promoted someone@example.test to admin.']);
    const r = await t.db.query('SELECT role, disabled_at, deleted_at FROM users WHERE id = $1', [u.id]);
    expect(r.rows[0]).toEqual({ role: 'admin', disabled_at: null, deleted_at: null });
    expect((await auditActions()).at(-1)).toMatchObject({ action: 'user.role_change', details: { from: 'user', to: 'admin', via: 'cli' } });
  });

  it('create-invite makes codes for a role', async () => {
    const { out } = await run('create-invite', '3', 'dev');
    expect(out).toHaveLength(3);
    const r = await t.db.query("SELECT role_on_signup FROM invite_codes WHERE note = 'cli'");
    expect(r.rows.map((x) => x.role_on_signup)).toEqual(['dev', 'dev', 'dev']);
    await expect(run('create-invite', '1', 'boss')).rejects.toThrow();
  });

  it('reset-link prints a one-time link on the public web address', async () => {
    await makeUser(t.db, 'forgot@example.test');
    const { out } = await run('reset-link', 'forgot@example.test');
    expect(out[0]).toMatch(/^https:\/\/maps\.test\/reset-password\?token=\S+\n\(expires \d{4}-/);
    await expect(run('reset-link', 'nobody@example.test')).rejects.toThrow('No user nobody@example.test');
  });

  it('prints usage: success with no command, failure for an unknown one', async () => {
    expect(await run(undefined)).toEqual({ code: 0, out: [USAGE] });
    expect(await run('frobnicate')).toEqual({ code: 1, out: [USAGE] });
  });

  it('runs as a program with the database from the environment', async () => {
    const exec = promisify(execFile);
    const tsx = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));
    const cli = (args: string[], env: Record<string, string>) =>
      exec(tsx, ['--conditions=development', 'src/cli.ts', ...args], { cwd: fileURLToPath(new URL('../..', import.meta.url)), env: { ...process.env, ...env } });
    expect((await cli(['migrate'], { DATABASE_URL: t.url })).stdout.trim()).toBe('Database is up to date');
    await expect(cli(['nope'], { DATABASE_URL: t.url })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('Commands:') });
    await expect(cli(['reset-link', 'nobody@example.test'], { DATABASE_URL: t.url })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('No user nobody@example.test') });
    await expect(cli(['migrate'], { DATABASE_URL: '' })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('DATABASE_URL is required') });
  });
});
