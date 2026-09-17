import pg from 'pg';

// Return bigint columns as strings (H3 cells) and numeric as numbers where safe.
pg.types.setTypeParser(20, (v) => v); // int8 -> string
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric -> number

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({ connectionString, max });
}

/** Run fn inside a transaction on a dedicated client. */
export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
