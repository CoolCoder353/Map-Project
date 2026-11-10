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
    await store.append(Array.from({ length: 25 }, (_, i) => pt(i)), 'u1');
    const sent: string[] = [];
    const res = await flushQueue(store, async (req) => void sent.push(`${req.batchId}:${req.points.length}`), ids, 'u1', { batchSize: 10 });
    expect(res).toMatchObject({ uploaded: 25, batches: 3, remaining: 0, error: null });
    expect(sent.map((s) => s.split(':')[1])).toEqual(['10', '10', '5']);
  });

  it('retries a failed batch with the same batch id', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(1), pt(2)], 'u1');
    const seen: string[] = [];
    let fail = true;
    const upload = async (req: { batchId: string }) => {
      seen.push(req.batchId);
      if (fail) throw new Error('offline');
    };
    const first = await flushQueue(store, upload, ids, 'u1');
    expect(first.error).toBeTruthy();
    expect(first.remaining).toBe(2);
    await store.append([pt(3)], 'u1'); // new points arrive while offline
    fail = false;
    const second = await flushQueue(store, upload, ids, 'u1');
    expect(second.remaining).toBe(0);
    expect(seen[0]).toBe(seen[1]); // same id retried
    expect(seen).toHaveLength(3);
  });

  it('keeps navigation sessions and background points in separate batches', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(1), pt(2), pt(3, { source: 'navigation', mode: 'car', sessionId: '11111111-1111-4111-8111-111111111111' }), pt(4)], 'u1');
    const reqs: Array<{ source: string; n: number; session?: string }> = [];
    await flushQueue(store, async (r) => void reqs.push({ source: r.source, n: r.points.length, ...(r.navigationSessionId ? { session: r.navigationSessionId } : {}) }), ids, 'u1');
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

  it('sends where a navigated trip is going, and nothing of the kind for background points (R2-P5)', async () => {
    const session = '11111111-1111-4111-8111-111111111111';
    const nav = toBatchRequest({ batchId: ids(), points: [pt(1, { source: 'navigation', mode: 'car', sessionId: session, destination: ' Woolworths ' })] });
    expect(nav.destinationName).toBe('Woolworths');
    expect(TrackBatchRequestSchema.safeParse(nav).success).toBe(true);
    const store = new MemoryQueueStore();
    await store.append([pt(2, { source: 'navigation', mode: 'car', sessionId: session, destination: 'Gym' })], 'u1');
    expect((await store.claim(10, ids, 'u1'))!.points[0]!.destination).toBe('Gym');
    expect(toBatchRequest({ batchId: ids(), points: [pt(3, { destination: 'Gym' })] }).destinationName).toBeUndefined();
    expect(toBatchRequest({ batchId: ids(), points: [pt(4, { source: 'navigation', sessionId: session, destination: '  ' })] }).destinationName).toBeUndefined();
  });

  it('throws away a batch the server will never accept, so later points still upload', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(1), pt(2)], 'u1');
    const sent: number[] = [];
    let reject = true;
    const upload = async (req: { points: unknown[] }) => {
      sent.push(req.points.length);
      if (reject) throw Object.assign(new Error('Invalid request'), { status: 400 });
    };
    const first = await flushQueue(store, upload, ids, 'u1');
    expect(first).toMatchObject({ uploaded: 0, dropped: 2, remaining: 0, error: null });

    reject = false;
    await store.append([pt(3)], 'u1');
    const second = await flushQueue(store, upload, ids, 'u1');
    expect(second).toMatchObject({ uploaded: 1, dropped: 0, remaining: 0 });
  });

  it('leaves out a point the server would refuse, not the whole batch with it', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(0), pt(1, { lat: Number.NaN }), pt(2, { lon: 500 }), pt(3, { accuracyM: Number.NaN, speedMps: Number.POSITIVE_INFINITY }), pt(4)], 'u1');
    const sent: number[] = [];
    const res = await flushQueue(store, async (req) => {
      expect(TrackBatchRequestSchema.safeParse(req).success).toBe(true);
      sent.push(req.points.length);
    }, ids, 'u1');
    expect(sent).toEqual([3]);
    expect(res).toMatchObject({ uploaded: 3, dropped: 2, remaining: 0, error: null });
  });

  it('clears a batch with nothing usable in it without calling the server', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(0, { ts: 0 }), pt(1, { lat: 91 })], 'u1');
    let calls = 0;
    const res = await flushQueue(store, async () => void calls++, ids, 'u1');
    expect(calls).toBe(0);
    expect(res).toMatchObject({ uploaded: 0, dropped: 2, remaining: 0 });
  });

  it('uploads only the signed-in account’s points, leaving another’s until it signs in again', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(0), pt(1)], 'test-account');
    await store.append([pt(2)], 'owner');
    const sent: Array<{ who: string; n: number }> = [];
    const as = (who: string) => flushQueue(store, async (req) => void sent.push({ who, n: req.points.length }), ids, who);

    // The phone's owner signs in after the test account signed out: none of its points go up as theirs.
    expect(await as('owner')).toMatchObject({ uploaded: 1, remaining: 0 });
    expect(sent).toEqual([{ who: 'owner', n: 1 }]);
    expect(await store.count()).toBe(2); // the test account's, still waiting
    // The test account signs in again later and gets its own.
    expect(await as('test-account')).toMatchObject({ uploaded: 2, remaining: 0 });
    expect(await store.count()).toBe(0);
  });

  it('keeps a batch claimed by one account away from another', async () => {
    const store = new MemoryQueueStore();
    await store.append([pt(0)], 'a');
    await store.append([pt(1)], 'b');
    const claimed = await store.claim(10, ids, 'a');
    expect(claimed!.points).toHaveLength(1);
    const forB = await store.claim(10, ids, 'b');
    expect(forB!.batchId).not.toBe(claimed!.batchId);
    expect(forB!.points[0]!.lon).toBe(pt(1).lon);
  });

  it('never hands one account a batch holding another’s points, old ones included', async () => {
    const store = new MemoryQueueStore();
    await store.appendUnowned([pt(0)]);
    await store.append([pt(1)], 'b');
    expect((await store.claim(10, ids, 'b'))!.points).toHaveLength(2);
    expect(await store.claim(10, ids, 'a')).toBeNull();
  });

  it('sends points queued before accounts were kept as the signed-in account’s', async () => {
    const store = new MemoryQueueStore();
    await store.appendUnowned([pt(0)]);
    expect(await flushQueue(store, async () => undefined, ids, 'whoever')).toMatchObject({ uploaded: 1, remaining: 0 });
  });
});
