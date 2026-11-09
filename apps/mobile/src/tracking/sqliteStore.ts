import * as SQLite from 'expo-sqlite';
import { type ClaimedBatch, type QueueStore, type QueuedPoint, groupKey } from './queue';

interface Row {
  id: number;
  ts: number;
  lon: number;
  lat: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  source: 'background' | 'navigation';
  mode: 'car' | 'foot' | null;
  session_id: string | null;
  batch_id: string | null;
  account_id: string | null;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('wayfinder-tracking.db');
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS queued_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts REAL NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL,
        accuracy_m REAL, speed_mps REAL, heading_deg REAL,
        source TEXT NOT NULL, mode TEXT, session_id TEXT, batch_id TEXT
      );
      CREATE INDEX IF NOT EXISTS queued_points_batch ON queued_points (batch_id);
    `);
    // Version 1: each point records the account it was recorded under. Points already queued
    // keep a null account and go up as whoever is signed in when they're sent.
    const v = await d.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((v?.user_version ?? 0) < 1) await d.execAsync('ALTER TABLE queued_points ADD COLUMN account_id TEXT; PRAGMA user_version = 1;');
    return d;
  })().catch((err: unknown) => {
    // Let the next call try again rather than failing for as long as the app runs.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

const toPoint = (r: Row): QueuedPoint => ({
  ts: r.ts,
  lon: r.lon,
  lat: r.lat,
  accuracyM: r.accuracy_m,
  speedMps: r.speed_mps,
  headingDeg: r.heading_deg,
  source: r.source,
  mode: r.mode,
  sessionId: r.session_id,
});

const MINE = '(account_id = ? OR account_id IS NULL)';

/** Durable queue on the device; survives the app being killed while offline. */
export const sqliteQueueStore: QueueStore = {
  async append(points, accountId) {
    if (points.length === 0) return;
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const p of points) {
        await d.runAsync(
          'INSERT INTO queued_points (ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          p.ts, p.lon, p.lat, p.accuracyM, p.speedMps, p.headingDeg, p.source, p.mode, p.sessionId, accountId,
        );
      }
    });
  },
  async claim(limit, newBatchId, accountId): Promise<ClaimedBatch | null> {
    const d = await db();
    const pending = await d.getFirstAsync<{ batch_id: string }>(`SELECT batch_id FROM queued_points WHERE batch_id IS NOT NULL AND ${MINE} LIMIT 1`, accountId);
    if (pending) {
      const rows = await d.getAllAsync<Row>('SELECT * FROM queued_points WHERE batch_id = ? ORDER BY id', pending.batch_id);
      return { batchId: pending.batch_id, points: rows.map(toPoint) };
    }
    const rows = await d.getAllAsync<Row>(`SELECT * FROM queued_points WHERE batch_id IS NULL AND ${MINE} ORDER BY id LIMIT ?`, accountId, limit);
    if (rows.length === 0) return null;
    const key = groupKey({ source: rows[0]!.source, sessionId: rows[0]!.session_id, mode: rows[0]!.mode });
    const picked: Row[] = [];
    for (const r of rows) {
      if (groupKey({ source: r.source, sessionId: r.session_id, mode: r.mode }) !== key) break;
      picked.push(r);
    }
    const id = newBatchId();
    const last = picked[picked.length - 1]!.id;
    // Another account's points may sit between these ids; they stay unclaimed.
    await d.runAsync(`UPDATE queued_points SET batch_id = ? WHERE id >= ? AND id <= ? AND batch_id IS NULL AND ${MINE}`, id, picked[0]!.id, last, accountId);
    return { batchId: id, points: picked.map(toPoint) };
  },
  async complete(batchId) {
    const d = await db();
    await d.runAsync('DELETE FROM queued_points WHERE batch_id = ?', batchId);
  },
  async count(accountId) {
    const d = await db();
    const r =
      accountId === undefined
        ? await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM queued_points')
        : await d.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM queued_points WHERE ${MINE}`, accountId);
    return r?.n ?? 0;
  },
};
