import type { Role } from '@wayfinder/shared';
import type { DbClient } from '../../src/db/pool.js';
import { hashPassword } from '../../src/lib/passwords.js';

let cachedHash: Promise<string> | undefined;

export async function makeUser(db: DbClient, email: string, role: Role = 'user'): Promise<{ id: string; email: string }> {
  cachedHash ??= hashPassword('test password 123');
  const r = await db.query<{ id: string }>('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id', [
    email,
    await cachedHash,
    role,
  ]);
  return { id: r.rows[0]!.id, email };
}
