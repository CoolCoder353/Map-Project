import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** The advisory lock a migrating session holds. Any number will do, as long as nothing else uses it. */
const MIGRATION_LOCK = 7_203_914;

/**
 * Apply pending *.sql migrations in filename order, each in its own transaction.
 *
 * The API and the worker both do this as they start, often in the same second, so it happens
 * under a lock: the second one waits, then finds the migrations already applied. Without it both
 * ran the same migration, and the loser stopped with whatever error the collision produced.
 */
export async function migrate(db: Db, log: (msg: string) => void = () => undefined): Promise<string[]> {
  // One session throughout: the lock belongs to it, and a pool may have only one to give.
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`applied migration ${file}`);
        ran.push(file);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    return ran;
  } finally {
    const unlocked = await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).then(
      () => true,
      () => false,
    );
    // A session that couldn't give the lock back is closed, which gives it back.
    client.release(!unlocked);
  }
}
