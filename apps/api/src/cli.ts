/**
 * Admin CLI (run inside the api container):
 *   node dist/cli.js migrate
 *   node dist/cli.js bootstrap-admin <email> [password]   create or promote the first admin
 *   node dist/cli.js create-invite [count] [role]
 *   node dist/cli.js reset-link <email>
 */
import { randomBytes } from 'node:crypto';
import {
  audit,
  authService,
  createPool,
  findUserByEmail,
  hashPassword,
  inviteService,
  migrate,
} from '@wayfinder/core';
import { EmailSchema, PasswordSchema, RoleSchema } from '@wayfinder/shared';

const [command, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const db = createPool(url, 2);

async function main() {
  switch (command) {
    case 'migrate': {
      const ran = await migrate(db, console.log);
      console.log(ran.length ? `Applied ${ran.length} migration(s)` : 'Database is up to date');
      break;
    }
    case 'bootstrap-admin': {
      const email = EmailSchema.parse(args[0]);
      await migrate(db);
      const existing = await findUserByEmail(db, email);
      if (existing) {
        await db.query("UPDATE users SET role = 'admin', disabled_at = NULL, deleted_at = NULL WHERE id = $1", [existing.id]);
        await audit(db, { actorId: null, action: 'user.role_change', targetType: 'user', targetId: existing.id, details: { from: existing.role, to: 'admin', via: 'cli' } });
        console.log(`Promoted ${email} to admin.`);
      } else {
        const password = args[1] ?? randomBytes(12).toString('base64url');
        PasswordSchema.parse(password);
        const r = await db.query<{ id: string }>("INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id", [
          email,
          await hashPassword(password),
        ]);
        await audit(db, { actorId: null, action: 'user.create_admin', targetType: 'user', targetId: r.rows[0]!.id, details: { via: 'cli' } });
        console.log(`Created admin ${email}${args[1] ? '' : ` with password: ${password}`}`);
        if (!args[1]) console.log('Change it after signing in (Settings → reset link from the dashboard or `reset-link`).');
      }
      break;
    }
    case 'create-invite': {
      const count = Number(args[0] ?? 1);
      const role = RoleSchema.parse(args[1] ?? 'user');
      const codes = await inviteService.createInvites(db, { count, expiresInDays: 14, note: 'cli', roleOnSignup: role, createdBy: null });
      await audit(db, { actorId: null, action: 'invite.create', targetType: 'invite', details: { count, roleOnSignup: role, via: 'cli' } });
      codes.forEach((c) => console.log(c));
      break;
    }
    case 'reset-link': {
      const email = EmailSchema.parse(args[0]);
      const user = await findUserByEmail(db, email);
      if (!user) throw new Error(`No user ${email}`);
      const link = await authService.createPasswordResetLink(db, user.id, null, process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173');
      await audit(db, { actorId: null, action: 'user.reset_link', targetType: 'user', targetId: user.id, details: { via: 'cli' } });
      console.log(`${link.url}\n(expires ${link.expiresAt.toISOString()})`);
      break;
    }
    default:
      console.log('Commands: migrate | bootstrap-admin <email> [password] | create-invite [count] [role] | reset-link <email>');
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
