/// <reference types="jest" />
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

type MockRow = Record<string, unknown>;
const mockDb: {
  rows: MockRow[];
  nextId: number;
  [fn: string]: unknown;
} = {
  rows: [] as MockRow[],
  nextId: 1,
  execAsync: jest.fn(async () => undefined),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
  runAsync: jest.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.startsWith('INSERT')) {
      const [ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id] = args;
      mockDb.rows.push({ id: mockDb.nextId++, ts, lon, lat, accuracy_m, speed_mps, heading_deg, source, mode, session_id, batch_id: null });
    } else if (sql.startsWith('UPDATE')) {
      const [id, from, to] = args as [string, number, number];
      for (const r of mockDb.rows) if ((r.id as number) >= from && (r.id as number) <= to) r.batch_id = id;
    } else if (sql.startsWith('DELETE')) {
      mockDb.rows = mockDb.rows.filter((r: MockRow) => r.batch_id !== args[0]);
    }
  }),
  getFirstAsync: jest.fn(async (sql: string): Promise<object | null> => {
    if (sql.includes('count(*)')) return { n: mockDb.rows.length };
    const r = mockDb.rows.find((x: MockRow) => x.batch_id !== null);
    return r ? { batch_id: r.batch_id } : null;
  }),
  getAllAsync: jest.fn(async (sql: string, arg: unknown) =>
    sql.includes('WHERE batch_id') ? mockDb.rows.filter((r: MockRow) => r.batch_id === arg) : mockDb.rows.slice(0, arg as number),
  ),
};
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));
let mockConnected: boolean | null = true;
jest.mock('@react-native-community/netinfo', () => ({ fetch: async () => ({ isConnected: mockConnected }) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
const mockRequest = jest.fn(async (_path: string, _init: unknown) => ({ accepted: 1, duplicate: false }));
const mockApi = { hasAccessToken: true, refresh: jest.fn(async () => null), request: (p: string, i: unknown) => mockRequest(p, i) };
// A getter: the module is loaded (by the imports below) before this file's constants exist.
jest.mock('../src/lib/api', () => ({
  get api() {
    return mockApi;
  },
}));

import { BACKGROUND_TASK, reconcileTracking, requestTrackingPermission, startBackgroundTracking, stopBackgroundTracking, trackingPermission } from '../src/tracking/background';
import { setNavigationRecording } from '../src/tracking/navigationRecording';
import { sqliteQueueStore } from '../src/tracking/sqliteStore';
import { syncQueue } from '../src/tracking/sync';

// Defined when the module loads, so Android can wake it; grab it before mocks are cleared.
type Task = (body: { data?: { locations: unknown[] }; error?: unknown }) => Promise<void>;
const [taskName, mockTask] = jest.mocked(TaskManager.defineTask).mock.calls[0] as unknown as [string, Task];

const point = (ts: number, over: object = {}) => ({ ts, lon: 153, lat: -27.4, accuracyM: 5, speedMps: 1, headingDeg: 0, source: 'background' as const, mode: null, sessionId: null, ...over });
const loc = (ts: number) => ({ timestamp: ts, coords: { longitude: 153, latitude: -27.4, accuracy: 8, speed: null, heading: null } });

beforeEach(() => {
  mockDb.rows = [];
  mockConnected = true;
  mockApi.hasAccessToken = true;
  jest.clearAllMocks();
});

describe('the on-phone queue', () => {
  it('batches points of one kind together, keeps a claimed batch until it is sent, then removes it', async () => {
    await sqliteQueueStore.append([point(1), point(2), point(3, { source: 'navigation', mode: 'car', sessionId: 's1' })]);
    await sqliteQueueStore.append([]);
    expect(await sqliteQueueStore.count()).toBe(3);
    const first = await sqliteQueueStore.claim(10, () => 'b1');
    expect(first!.batchId).toBe('b1');
    expect(first!.points.map((p) => p.ts)).toEqual([1, 2]);
    // Retrying before it is sent returns the same batch, so the server can drop a duplicate.
    expect((await sqliteQueueStore.claim(10, () => 'b2'))!.batchId).toBe('b1');
    await sqliteQueueStore.complete('b1');
    const next = await sqliteQueueStore.claim(10, () => 'b3');
    expect(next!.points).toEqual([point(3, { source: 'navigation', mode: 'car', sessionId: 's1' })]);
    await sqliteQueueStore.complete('b3');
    expect(await sqliteQueueStore.claim(10, () => 'b4')).toBeNull();
  });
});

describe('uploading', () => {
  it('uploads everything queued when online, and shares one run between callers', async () => {
    await sqliteQueueStore.append([point(1000), point(2000)]);
    const [a, b] = await Promise.all([syncQueue(), syncQueue()]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ uploaded: 2, remaining: 0 });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0]![0]).toBe('api/tracks/batches');
  });

  it('waits while offline', async () => {
    mockConnected = false;
    await sqliteQueueStore.append([point(1000)]);
    expect(await syncQueue()).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('restores the session first when woken in the background', async () => {
    mockApi.hasAccessToken = false;
    await sqliteQueueStore.append([point(1000)]);
    await syncQueue();
    expect(mockApi.refresh).toHaveBeenCalled();
  });
});

describe('background tracking', () => {
  it('queues fixes from the background task and uploads once 50 are waiting', async () => {
    expect(taskName).toBe(BACKGROUND_TASK);
    await mockTask({ data: { locations: Array.from({ length: 10 }, (_, i) => loc(1000 + i)) } });
    expect(mockDb.rows).toHaveLength(10);
    expect(mockDb.rows[0]).toMatchObject({ source: 'background', mode: null, speed_mps: null, accuracy_m: 8 });
    expect(mockRequest).not.toHaveBeenCalled();
    await mockTask({ data: { locations: Array.from({ length: 40 }, (_, i) => loc(2000 + i)) } });
    expect(mockRequest).toHaveBeenCalled();
    await mockTask({ error: new Error('boom') });
    await mockTask({ data: { locations: [] } });
  });

  it('leaves the time a navigated trip is recording to that trip', async () => {
    setNavigationRecording(true);
    await mockTask({ data: { locations: [loc(1000), loc(1001)] } });
    expect(mockDb.rows).toHaveLength(0);
    setNavigationRecording(false);
    await mockTask({ data: { locations: [loc(1002)] } });
    expect(mockDb.rows).toHaveLength(1);
  });

  it('reads and asks for permission: while using first, then all the time', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    expect(await trackingPermission()).toBe('denied');
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    expect(await trackingPermission()).toBe('foreground-only');
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    expect(await trackingPermission()).toBe('granted');

    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    const yes = async () => true;
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    expect(await requestTrackingPermission(yes)).toBe('denied');
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    expect(await requestTrackingPermission(yes)).toBe('foreground-only');
    jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    expect(await requestTrackingPermission(yes)).toBe('granted');
  });

  // Google Play's prominent disclosure: shown, and agreed to, before Android's location prompts.
  it('shows the disclosure before asking Android, and asks nothing when it is declined', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    const order: string[] = [];
    jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => (order.push('android'), { granted: true }) as never);
    jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as never);

    expect(await requestTrackingPermission(async () => (order.push('declined'), false))).toBe('declined');
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();

    expect(await requestTrackingPermission(async () => (order.push('disclosure'), true))).toBe('granted');
    expect(order).toEqual(['declined', 'disclosure', 'android']);
  });

  it('skips the disclosure when “Allow all the time” is already granted', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    const confirm = jest.fn(async () => false);
    expect(await requestTrackingPermission(confirm)).toBe('granted');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('starts once with a visible notification naming the app, and stops', async () => {
    await startBackgroundTracking('Roamer');
    expect(jest.mocked(Location.startLocationUpdatesAsync).mock.calls[0]![1]).toMatchObject({ distanceInterval: 25, foregroundService: { notificationTitle: 'Roamer is recording your travels' } });
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
    await startBackgroundTracking('Roamer');
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    await stopBackgroundTracking();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(BACKGROUND_TASK);
  });

  it('follows the account setting, but only starts with “all the time” permission', async () => {
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    await reconcileTracking(true, 'Wayfinder');
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    await reconcileTracking(true, 'Wayfinder');
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalled();
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
    await reconcileTracking(false, 'Wayfinder');
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
  });
});
