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
    return d;
  })();
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

/** Durable queue on the device; survives the app being killed while offline. */
export const sqliteQueueStore: QueueStore = {
  async append(points) {
    if (points.length === 0) return;
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const p of points) {
        await d.runAsync(
          'INSERT INTO queued_points (ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          p.ts, p.lon, p.lat, p.accuracyM, p.speedMps, p.headingDeg, p.source, p.mode, p.sessionId,
        );
      }
    });
  },
  async claim(limit, newBatchId): Promise<ClaimedBatch | null> {
    const d = await db();
    const pending = await d.getFirstAsync<{ batch_id: string }>('SELECT batch_id FROM queued_points WHERE batch_id IS NOT NULL LIMIT 1');
    if (pending) {
      const rows = await d.getAllAsync<Row>('SELECT * FROM queued_points WHERE batch_id = ? ORDER BY id', pending.batch_id);
      return { batchId: pending.batch_id, points: rows.map(toPoint) };
    }
    const rows = await d.getAllAsync<Row>('SELECT * FROM queued_points ORDER BY id LIMIT ?', limit);
    if (rows.length === 0) return null;
    const key = groupKey({ source: rows[0]!.source, sessionId: rows[0]!.session_id, mode: rows[0]!.mode });
    const picked: Row[] = [];
    for (const r of rows) {
      if (groupKey({ source: r.source, sessionId: r.session_id, mode: r.mode }) !== key) break;
      picked.push(r);
    }
    const id = newBatchId();
    const last = picked[picked.length - 1]!.id;
    await d.runAsync('UPDATE queued_points SET batch_id = ? WHERE id >= ? AND id <= ?', id, picked[0]!.id, last);
    return { batchId: id, points: picked.map(toPoint) };
  },
  async complete(batchId) {
    const d = await db();
    await d.runAsync('DELETE FROM queued_points WHERE batch_id = ?', batchId);
  },
  async count() {
    const d = await db();
    return (await d.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM queued_points'))?.n ?? 0;
  },
};
