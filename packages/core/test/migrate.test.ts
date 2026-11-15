import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import type { Db } from '../src/db/pool.js';

/**
 * A stand-in for Postgres that knows just enough to show two services migrating at once: the list
 * of applied migrations (a second insert of the same name is a duplicate key, as in Postgres), and
 * one advisory lock that makes a second session wait for the first. Every query gives way to
 * whatever else is running, so two migrations interleave the way two connections do.
 */
function fakePostgres(failOn: RegExp | null = null) {
  const applied = new Set<string>();
  const state = { applied, holder: null as object | null, open: 0, destroyed: 0 };
  const waiting: Array<() => void> = [];
  const tick = () => new Promise<void>((r) => setImmediate(r));

  const session = () => {
    const me = {};
    let pending: string | null = null;
    return {
      async query(sql: string, params: unknown[] = []) {
        await tick();
        if (failOn?.test(sql)) throw new Error('relation "broken" does not exist');
        if (/pg_advisory_lock/.test(sql)) {
          while (state.holder && state.holder !== me) await new Promise<void>((r) => waiting.push(r));
          state.holder = me;
        } else if (/pg_advisory_unlock/.test(sql)) {
          if (state.holder === me) state.holder = null;
          waiting.splice(0).forEach((wake) => wake());
        } else if (/^SELECT name FROM schema_migrations/.test(sql)) {
          return { rows: [...applied].map((name) => ({ name })) };
        } else if (/^INSERT INTO schema_migrations/.test(sql)) {
          const name = String(params[0]);
          if (applied.has(name) || pending) throw new Error('duplicate key value violates unique constraint');
          pending = name;
        } else if (sql === 'COMMIT') {
          if (pending) applied.add(pending);
          pending = null;
        } else if (sql === 'ROLLBACK') {
          pending = null;
        }
        return { rows: [] };
      },
    };
  };

  const pool = session();
  const db = {
    query: pool.query,
    async connect() {
      state.open++;
      const s = session();
      return {
        query: s.query,
        release(destroy?: boolean) {
          state.open--;
          if (destroy) {
            state.destroyed++;
            // A closed connection gives up its locks.
            void s.query('SELECT pg_advisory_unlock(0)');
          }
        },
      };
    },
  };
  return { db: db as unknown as Db, state };
}

describe('migrations', () => {
  it('are applied once each when two services start together', async () => {
    const { db, state } = fakePostgres();
    const [first, second] = await Promise.all([migrate(db), migrate(db)]);
    expect(first.length).toBeGreaterThan(10);
    // The one that waited finds them all done.
    expect(second).toEqual([]);
    expect([...state.applied]).toEqual(first);
    expect(state.holder).toBeNull();
    expect(state.open).toBe(0);
  });

  it('applies only what is new', async () => {
    const { db } = fakePostgres();
    const all = await migrate(db);
    expect(all[0]).toMatch(/^001_/);
    expect(all).toEqual([...all].sort());
    expect(await migrate(db)).toEqual([]);
  });

  it('lets the next one in after a migration fails', async () => {
    const { db, state } = fakePostgres(/^INSERT INTO schema_migrations/);
    await expect(migrate(db)).rejects.toThrow(/^Migration 001_\S+ failed: relation "broken" does not exist/);
    expect(state.applied.size).toBe(0);
    expect(state.holder).toBeNull();
    expect(state.open).toBe(0);
  });
});
