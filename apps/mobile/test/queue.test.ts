import { describe, expect, it } from 'vitest';
import { MemoryQueueStore, type QueuedPoint, flushQueue, toBatchRequest } from '../src/tracking/queue';
import { TrackBatchRequestSchema } from '@wayfinder/shared/schemas';

const pt = (i: number, extra: Partial<QueuedPoint> = {}): QueuedPoint => ({
  ts: 1_700_000_000_000 + i * 5000,
  lon: 149.1 + i * 0.0001,
  lat: -35.3,
  accuracyM: 8,
  speedMps: 1.4,
  headingDeg: 90,
  source: 'background',
  mode: null,
  sessionId: null,
  ...extra,
});

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('tracking queue', () => {
  it('uploads in batches and empties the queue', async () => {
    const store = new MemoryQueueStore();
    await store.append(Array.from({ length: 25 }, (_, i) => pt(i)));
    const sent: string[] = [];
    const res = await flushQueue(store, async (req) => void sent.push(`${req.batchId}:${req.points.length}`), ids, { batchSize: 10 });
    expect(res).toMatchObject({ uploaded: 25, batches: 3, remaining: 0, error: null });
    expect(sent.map((s) => s.split(':')[1])).toEqual(['10', '10', '5']);
  });

  it('retries a failed batch with the same batch id', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(1), pt(2)]);
    const seen: string[] = [];
    let fail = true;
    const upload = async (req: { batchId: string }) => {
      seen.push(req.batchId);
      if (fail) throw new Error('offline');
    };
    const first = await flushQueue(store, upload, ids);
    expect(first.error).toBeTruthy();
    expect(first.remaining).toBe(2);
    await store.append([pt(3)]); // new points arrive while offline
    fail = false;
    const second = await flushQueue(store, upload, ids);
    expect(second.remaining).toBe(0);
    expect(seen[0]).toBe(seen[1]); // same id retried
    expect(seen).toHaveLength(3);
  });

  it('keeps navigation sessions and background points in separate batches', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(1), pt(2), pt(3, { source: 'navigation', mode: 'car', sessionId: '11111111-1111-4111-8111-111111111111' }), pt(4)]);
    const reqs: Array<{ source: string; n: number; session?: string }> = [];
    await flushQueue(store, async (r) => void reqs.push({ source: r.source, n: r.points.length, ...(r.navigationSessionId ? { session: r.navigationSessionId } : {}) }), ids);
    expect(reqs).toEqual([
      { source: 'background', n: 2 },
      { source: 'navigation', n: 1, session: '11111111-1111-4111-8111-111111111111' },
      { source: 'background', n: 1 },
    ]);
  });

  it('produces requests the server schema accepts, sanitising sensor values', () => {
    const req = toBatchRequest({ batchId: ids(), points: [pt(1, { speedMps: -1, headingDeg: 400, accuracyM: 45_000 })] });
    expect(TrackBatchRequestSchema.safeParse(req).success).toBe(true);
    expect(req.points[0]).toMatchObject({ speedMps: null, headingDeg: 40, accuracyM: 10_000 });
  });

  it('throws away a batch the server will never accept, so later points still upload', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(1), pt(2)]);
    const sent: number[] = [];
    let reject = true;
    const upload = async (req: { points: unknown[] }) => {
      sent.push(req.points.length);
      if (reject) throw Object.assign(new Error('Invalid request'), { status: 400 });
    };
    const first = await flushQueue(store, upload, ids);
    expect(first).toMatchObject({ uploaded: 0, dropped: 2, remaining: 0, error: null });

    reject = false;
    await store.append([pt(3)]);
    const second = await flushQueue(store, upload, ids);
    expect(second).toMatchObject({ uploaded: 1, dropped: 0, remaining: 0 });
  });
});
