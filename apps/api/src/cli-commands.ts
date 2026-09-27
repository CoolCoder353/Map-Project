/** The admin CLI's commands, separate from process handling so tests can run them. See cli.ts. */
import { randomBytes } from 'node:crypto';
import { type Db, audit, authService, findUserByEmail, hashPassword, inviteService, migrate } from '@wayfinder/core';
import { EmailSchema, PasswordSchema, RoleSchema } from '@wayfinder/shared';

export const USAGE = 'Commands: migrate | bootstrap-admin <email> [password] | create-invite [count] [role] | reset-link <email>';

/** Runs one command; returns the process exit code. Output goes through `print`. */
export async function runCommand(db: Db, command: string | undefined, args: string[], print: (line: string) => void, publicWebUrl = 'http://localhost:5173'): Promise<number> {
  switch (command) {
    case 'migrate': {
      const ran = await migrate(db, print);
      print(ran.length ? `Applied ${ran.length} migration(s)` : 'Database is up to date');
      return 0;
    }
    case 'bootstrap-admin': {
      const email = EmailSchema.parse(args[0]);
      await migrate(db);
      const existing = await findUserByEmail(db, email);
      if (existing) {
        await db.query("UPDATE users SET role = 'admin', disabled_at = NULL, deleted_at = NULL WHERE id = $1", [existing.id]);
        await audit(db, { actorId: null, action: 'user.role_change', targetType: 'user', targetId: existing.id, details: { from: existing.role, to: 'admin', via: 'cli' } });
        print(`Promoted ${email} to admin.`);
      } else {
        const password = args[1] ?? randomBytes(12).toString('base64url');
        PasswordSchema.parse(password);
        const r = await db.query<{ id: string }>("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id", [
          email,
          await hashPassword(password),
        ]);
        await audit(db, { actorId: null, action: 'user.create_admin', targetType: 'user', targetId: r.rows[0]!.id, details: { via: 'cli' } });
        print(`Created admin ${email}${args[1] ? '' : ` with password: ${password}`}`);
        if (!args[1]) print('Change it after signing in (Settings → reset link from the dashboard or `reset-link`).');
      }
      return 0;
    }
    case 'create-invite': {
      const count = Number(args[0] ?? 1);
      const role = RoleSchema.parse(args[1] ?? 'user');
      const codes = await inviteService.createInvites(db, { count, expiresInDays: 14, note: 'cli', roleOnSignup: role, createdBy: null });
      await audit(db, { actorId: null, action: 'invite.create', targetType: 'invite', details: { count, roleOnSignup: role, via: 'cli' } });
      codes.forEach((c) => print(c));
      return 0;
    }
    case 'reset-link': {
      const email = EmailSchema.parse(args[0]);
      const user = await findUserByEmail(db, email);
      if (!user) throw new Error(`No user ${email}`);
      const link = await authService.createPasswordResetLink(db, user.id, null, publicWebUrl);
      await audit(db, { actorId: null, action: 'user.reset_link', targetType: 'user', targetId: user.id, details: { via: 'cli' } });
      print(`${link.url}\n(expires ${link.expiresAt.toISOString()})`);
      return 0;
    }
    default:
      print(USAGE);
      return command ? 1 : 0;
  }
}
