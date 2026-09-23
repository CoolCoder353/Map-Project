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
}

export interface ClaimedBatch {
  batchId: string;
  points: QueuedPoint[];
}

/**
 * Durable point queue. A batch id is assigned when points are claimed and kept until the
 * upload succeeds, so retries reuse the same id and the server de-duplicates them.
 */
export interface QueueStore {
  append(points: QueuedPoint[]): Promise<void>;
  /** Return the pending claimed batch, or claim up to `limit` points sharing one group key. */
  claim(limit: number, newBatchId: () => string): Promise<ClaimedBatch | null>;
  complete(batchId: string): Promise<void>;
  count(): Promise<number>;
}

export const groupKey = (p: Pick<QueuedPoint, 'source' | 'sessionId' | 'mode'>) => `${p.source}|${p.sessionId ?? ''}|${p.mode ?? ''}`;

export function toBatchRequest(batch: ClaimedBatch): TrackBatchRequest {
  const first = batch.points[0]!;
  return {
    batchId: batch.batchId,
    source: first.source,
    ...(first.mode ? { mode: first.mode } : {}),
    ...(first.sessionId ? { navigationSessionId: first.sessionId } : {}),
    points: batch.points.map((p) => ({
      ts: Math.round(p.ts),
      lon: p.lon,
      lat: p.lat,
      // A fix from cell towers alone can claim tens of kilometres of accuracy, which the server
      // refuses; keep the point and cap the figure rather than losing the batch.
      accuracyM: p.accuracyM === null || p.accuracyM < 0 ? null : Math.min(10_000, p.accuracyM),
      speedMps: p.speedMps === null || p.speedMps < 0 ? null : Math.min(200, p.speedMps),
      headingDeg: p.headingDeg === null || p.headingDeg < 0 ? null : p.headingDeg % 360,
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
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<FlushResult> {
  const batchSize = opts.batchSize ?? 1000;
  const maxBatches = opts.maxBatches ?? 50;
  let uploaded = 0;
  let batches = 0;
  let dropped = 0;
  let error: unknown = null;
  while (batches < maxBatches) {
    const batch = await store.claim(batchSize, newBatchId);
    if (!batch || batch.points.length === 0) break;
    try {
      await upload(toBatchRequest(batch));
    } catch (err) {
      // The same batch is claimed again next time, so a batch the server will never accept
      // would block every later point for good. Throw it away and keep the queue moving.
      if ((err as { status?: number }).status === 400) {
        await store.complete(batch.batchId);
        dropped += batch.points.length;
        batches++;
        continue;
      }
      error = err;
      break;
    }
    await store.complete(batch.batchId);
    uploaded += batch.points.length;
    batches++;
  }
  return { uploaded, batches, remaining: await store.count(), dropped, error };
}

/** In-memory store (tests and fallback). */
export class MemoryQueueStore implements QueueStore {
  private rows: Array<QueuedPoint & { seq: number; batchId: string | null }> = [];
  private seq = 0;

  async append(points: QueuedPoint[]) {
    for (const p of points) this.rows.push({ ...p, seq: this.seq++, batchId: null });
  }

  async claim(limit: number, newBatchId: () => string): Promise<ClaimedBatch | null> {
    const pending = this.rows.find((r) => r.batchId !== null);
    if (pending) {
      const id = pending.batchId!;
      return { batchId: id, points: this.rows.filter((r) => r.batchId === id).map(strip) };
    }
    const first = this.rows[0];
    if (!first) return null;
    const key = groupKey(first);
    const id = newBatchId();
    const picked: typeof this.rows = [];
    for (const r of this.rows) {
      if (groupKey(r) !== key) break; // keep batches contiguous in time
      picked.push(r);
      if (picked.length >= limit) break;
    }
    picked.forEach((r) => (r.batchId = id));
    return { batchId: id, points: picked.map(strip) };
  }

  async complete(batchId: string) {
    this.rows = this.rows.filter((r) => r.batchId !== batchId);
  }

  async count() {
    return this.rows.length;
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
  };
}
