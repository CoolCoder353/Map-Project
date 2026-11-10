import type { Mode, TrackBatchRequest, TrackSource } from '@wayfinder/shared/schemas';

/** A GPS fix waiting to be uploaded. */
export interface QueuedPoint {
  ts: number;
  lon: number;
  lat: number;
  accuracyM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  source: TrackSource;
  mode: Mode | null;
  sessionId: string | null;
  /** Where a navigated trip is going ("Woolworths"), for Trips to name it (R2-P5). */
  destination?: string | null;
}

export interface ClaimedBatch {
  batchId: string;
  points: QueuedPoint[];
}

/**
 * Durable point queue. A batch id is assigned when points are claimed and kept until the
 * upload succeeds, so retries reuse the same id and the server de-duplicates them.
 * Each point belongs to the account signed in when it was recorded, and only that account
 * uploads it: points recorded on one account are never sent as another's after a switch.
 */
export interface QueueStore {
  append(points: QueuedPoint[], accountId: string): Promise<void>;
  /** Return this account's pending claimed batch, or claim up to `limit` of its points sharing one group key. */
  claim(limit: number, newBatchId: () => string, accountId: string): Promise<ClaimedBatch | null>;
  complete(batchId: string): Promise<void>;
  /** Points waiting: this account's, or everyone's. */
  count(accountId?: string): Promise<number>;
}

export const groupKey = (p: Pick<QueuedPoint, 'source' | 'sessionId' | 'mode'>) => `${p.source}|${p.sessionId ?? ''}|${p.mode ?? ''}`;

/** A point the server can accept: a real time and a place on Earth. */
const usable = (p: QueuedPoint) =>
  Number.isFinite(p.ts) && p.ts > 0 && Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90;

/** The upload for a batch, leaving out points the server would refuse (and the batch with them). */
export function toBatchRequest(batch: ClaimedBatch): TrackBatchRequest {
  const first = batch.points[0]!;
  return {
    batchId: batch.batchId,
    source: first.source,
    ...(first.mode ? { mode: first.mode } : {}),
    ...(first.sessionId ? { navigationSessionId: first.sessionId } : {}),
    ...(first.sessionId && first.destination?.trim() ? { destinationName: first.destination.trim().slice(0, 200) } : {}),
    points: batch.points.filter(usable).map((p) => ({
      ts: Math.round(p.ts),
      lon: p.lon,
      lat: p.lat,
      // A fix from cell towers alone can claim tens of kilometres of accuracy, which the server
      // refuses; keep the point and cap the figure rather than losing the batch.
      accuracyM: !Number.isFinite(p.accuracyM) || p.accuracyM! < 0 ? null : Math.min(10_000, p.accuracyM!),
      speedMps: !Number.isFinite(p.speedMps) || p.speedMps! < 0 ? null : Math.min(200, p.speedMps!),
      headingDeg: !Number.isFinite(p.headingDeg) || p.headingDeg! < 0 ? null : p.headingDeg! % 360,
    })),
  };
}

export interface FlushResult {
  uploaded: number;
  batches: number;
  remaining: number;
  /** Points the server refused as invalid, which were thrown away rather than retried. */
  dropped: number;
  error: unknown;
}

/** Upload queued points in batches until the queue is empty or an upload fails. */
export async function flushQueue(
  store: QueueStore,
  upload: (req: TrackBatchRequest) => Promise<void>,
  newBatchId: () => string,
  accountId: string,
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<FlushResult> {
  const batchSize = opts.batchSize ?? 1000;
  const maxBatches = opts.maxBatches ?? 50;
  let uploaded = 0;
  let batches = 0;
  let dropped = 0;
  let error: unknown = null;
  while (batches < maxBatches) {
    const batch = await store.claim(batchSize, newBatchId, accountId);
    if (!batch || batch.points.length === 0) break;
    const req = toBatchRequest(batch);
    dropped += batch.points.length - req.points.length;
    if (req.points.length === 0) {
      await store.complete(batch.batchId);
      batches++;
      continue;
    }
    try {
      await upload(req);
    } catch (err) {
      // The same batch is claimed again next time, so a batch the server will never accept
      // would block every later point for good. Throw it away and keep the queue moving.
      if ((err as { status?: number }).status === 400) {
        await store.complete(batch.batchId);
        dropped += req.points.length;
        batches++;
        continue;
      }
      error = err;
      break;
    }
    await store.complete(batch.batchId);
    uploaded += req.points.length;
    batches++;
  }
  return { uploaded, batches, remaining: await store.count(accountId), dropped, error };
}

/** In-memory store (tests and fallback). A null account is a point queued before accounts were kept. */
export class MemoryQueueStore implements QueueStore {
  private rows: Array<QueuedPoint & { seq: number; batchId: string | null; accountId: string | null }> = [];
  private seq = 0;

  /** Test helper: points queued by a version that didn't record the account. */
  async appendUnowned(points: QueuedPoint[]) {
    for (const p of points) this.rows.push({ ...p, seq: this.seq++, batchId: null, accountId: null });
  }

  async append(points: QueuedPoint[], accountId: string) {
    for (const p of points) this.rows.push({ ...p, seq: this.seq++, batchId: null, accountId });
  }

  async claim(limit: number, newBatchId: () => string, accountId: string): Promise<ClaimedBatch | null> {
    const mine = this.rows.filter((r) => r.accountId === accountId || r.accountId === null);
    const pending = mine.find((r) => r.batchId !== null);
    if (pending) {
      const id = pending.batchId!;
      return { batchId: id, points: mine.filter((r) => r.batchId === id && (r.accountId === accountId || r.accountId === null)).map(strip) };
    }
    const free = mine.filter((r) => r.batchId === null);
    const first = free[0];
    if (!first) return null;
    const key = groupKey(first);
    const id = newBatchId();
    const picked: typeof this.rows = [];
    for (const r of free) {
      if (groupKey(r) !== key) break; // keep batches contiguous in time
      picked.push(r);
      if (picked.length >= limit) break;
    }
    for (const r of picked) {
      r.batchId = id;
      r.accountId = accountId; // an older point with no account becomes this one's
    }
    return { batchId: id, points: picked.map(strip) };
  }

  async complete(batchId: string) {
    this.rows = this.rows.filter((r) => r.batchId !== batchId);
  }

  async count(accountId?: string) {
    return accountId === undefined ? this.rows.length : this.rows.filter((r) => r.accountId === accountId || r.accountId === null).length;
  }
}

function strip<T extends QueuedPoint>(r: T): QueuedPoint {
  return {
    ts: r.ts,
    lon: r.lon,
    lat: r.lat,
    accuracyM: r.accuracyM,
    speedMps: r.speedMps,
    headingDeg: r.headingDeg,
    source: r.source,
    mode: r.mode,
    sessionId: r.sessionId,
    ...(r.destination ? { destination: r.destination } : {}),
  };
}
