import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { type Db, createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';

export interface TestDb {
  db: Db;
  url: string;
  close(): Promise<void>;
}

/**
 * A migrated, empty database for one test file. Uses a throwaway database on
 * TEST_DATABASE_URL (real Postgres) when set, otherwise an in-process PGlite.
 */
export async function createTestDb(): Promise<TestDb> {
  const base = process.env.TEST_DATABASE_URL;
  if (base) {
    const name = `wf_test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    const db = createPool(url.toString(), 5);
    await migrate(db);
    return {
      db,
      url: url.toString(),
      async close() {
        await db.end();
        const c = new pg.Client({ connectionString: base });
        await c.connect();
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await c.end();
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const lite = await PGlite.create({ extensions: { pg_trgm } });
  const server = new PGLiteSocketServer({ db: lite, port: 0, host: '127.0.0.1', maxConnections: 5 } as never);
  await server.start();
  const conn = server.getServerConn(); // "127.0.0.1:PORT"
  const url = `postgres://postgres:postgres@${conn}/postgres`;
  const db = createPool(url, 1);
  await migrate(db);
  return {
    db,
    url,
    async close() {
      await db.end();
      await server.stop();
      await lite.close();
    },
  };
}
