/**
 * Dev-only Postgres without Docker: PGlite (Postgres in WASM) behind a local socket.
 *   pnpm dev:db  → postgres://postgres:postgres@127.0.0.1:55432/postgres
 * Data persists in ./data/pglite. Use real Postgres (infra/docker-compose.dev.yml) when available.
 */
import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dir = process.env.PGLITE_DIR ?? './data/pglite';
mkdirSync(dir, { recursive: true });
const db = await PGlite.create({ dataDir: dir, extensions: { pg_trgm } });
const server = new PGLiteSocketServer({ db, port: Number(process.env.PGLITE_PORT ?? 55432), host: '127.0.0.1', maxConnections: 30 } as never);
await server.start();
console.log(`PGlite listening on ${server.getServerConn()} (data: ${dir})`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
