/**
 * Server responses for component tests. Each is parsed with the shared schema, so a fixture that
 * drifts from the API contract fails here rather than passing a test the real server wouldn't.
 */
import {
  AdminUserDetailSchema,
  AdminUserSchema,
  AuditEntrySchema,
  AuthResponseSchema,
  CoverageStatsSchema,
  DeletedItemsSchema,
  DiscoverItemSchema,
  ErrorGroupSchema,
  ExploreRouteResponseSchema,
  FeedbackItemSchema,
  HealthResponseSchema,
  InviteSchema,
  JobListSchema,
  MetricPointSchema,
  PipelineRunSchema,
  PlaceSchema,
  PublicConfigSchema,
  PublicUserSchema,
  RouteSchema,
  TripDetailSchema,
  TripSummarySchema,
  UsageStatsSchema,
  type AdminUser,
  type AuthResponse,
  type CoverageStats,
  type DiscoverItem,
  type ExploreRouteResponse,
  type FeedbackItem,
  type Invite,
  type MetricPoint,
  type Place,
  type PublicConfig,
  type PublicUser,
  type Route,
  type TripDetail,
  type TripSummary,
} from '@wayfinder/shared';

/** Parse with the schema and fail on any field the schema doesn't know (zod drops them silently). */
function exact<T>(schema: { parse(v: unknown): T }, value: unknown): T {
  const parsed = schema.parse(value);
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
  const a = JSON.stringify(canon(parsed));
  const b = JSON.stringify(canon(value));
  if (a !== b) throw new Error(`Fixture has fields the API contract doesn't:\n  fixture: ${b}\n  schema:  ${a}`);
  return parsed;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const user = (over: Omit<Partial<PublicUser>, 'settings'> & { settings?: Partial<PublicUser['settings']> } = {}): PublicUser =>
  exact(PublicUserSchema, {
    id: 'u-1',
    email: 'sam@example.test',
    role: 'user',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
    settings: { trackingEnabled: true, defaultMode: 'car', exploreBudgetMin: 15, ...over.settings },
  });

export const auth = (u: PublicUser = user()): AuthResponse => exact(AuthResponseSchema, { accessToken: 'access-token', user: u });

export const config = (over: Partial<PublicConfig> = {}): PublicConfig =>
  exact(PublicConfigSchema, { appName: 'Wayfinder', voice: 'plain', feedbackEnabled: false, osmDataDate: null, ...over });

export const route = (over: DeepPartial<Route> = {}): Route =>
  exact(RouteSchema, {
    id: 'r-fast',
    kind: 'fastest',
    mode: 'car',
    distanceM: 12_300,
    durationS: 900,
    extraDurationS: 0,
    geometry: [
      [153.0, -27.4],
      [153.1, -27.5],
    ],
    instructions: [
      { sign: 0, text: 'Head north on Queen Street', streetName: 'Queen Street', distanceM: 300, durationS: 30, interval: [0, 1] },
      { sign: 4, text: 'Arrive at destination', streetName: '', distanceM: 0, durationS: 0, interval: [1, 1] },
    ],
    viaPoints: [],
    ...over,
    novelty: { totalKm: 12.3, newKm: 0, noveltyPct: 0, ...over.novelty },
  });

export const exploreResponse = (explore: Route[] = [route({ id: 'r-exp', kind: 'explore', extraDurationS: 420, novelty: { totalKm: 14, newKm: 6.2, noveltyPct: 44 } })]): ExploreRouteResponse =>
  exact(ExploreRouteResponseSchema, { fastest: route(), explore });

export const place = (over: Partial<Place> = {}): Place =>
  exact(PlaceSchema, { id: 'p-1', name: 'Gumdale State School', kind: 'poi', typeLabel: 'School', context: 'Gumdale QLD 4154', description: 'School, Gumdale QLD 4154', location: [153.15, -27.49], ...over });

export const trip = (over: Partial<TripSummary> = {}): TripSummary =>
  exact(TripSummarySchema, {
    id: 't-1',
    mode: 'car',
    source: 'background',
    startedAt: '2026-09-20T08:00:00.000Z',
    endedAt: '2026-09-20T08:30:00.000Z',
    distanceM: 18_000,
    newRoads: 3,
    ...over,
  });

export const tripDetail = (over: Partial<TripDetail> = {}): TripDetail =>
  exact(TripDetailSchema, {
    ...trip(),
    geometry: [
      [153.0, -27.4],
      [153.05, -27.45],
      [153.1, -27.5],
    ],
    points: [
      { ts: Date.parse('2026-09-20T08:00:00.000Z'), lon: 153.0, lat: -27.4 },
      { ts: Date.parse('2026-09-20T08:15:00.000Z'), lon: 153.05, lat: -27.45 },
      { ts: Date.parse('2026-09-20T08:30:00.000Z'), lon: 153.1, lat: -27.5 },
    ],
    ...over,
  });

export const coverageStats = (over: Partial<CoverageStats> = {}): CoverageStats =>
  exact(CoverageStatsSchema, {
    roadKm: 412.5,
    roadsTravelled: 1234,
    newRoadsWeek: 17,
    newRoadsMonth: 60,
    byMode: { carKm: 400, footKm: 12.5 },
    firstVisitAt: '2026-08-01T00:00:00.000Z',
    tripCount: 42,
    distanceKm: 980,
    ...over,
  });

export const discoverItem = (over: Partial<DiscoverItem> = {}): DiscoverItem =>
  exact(DiscoverItemSchema, { id: 'd-1', name: 'Mount Coot-tha Lookout', category: 'viewpoint', location: [152.95, -27.48], distanceM: 7_400, areaUnexploredPct: 80, score: 0.9, ...over });

// Admin dashboard

/** The parsed type of a schema. */
type Of<S extends { parse(v: unknown): unknown }> = ReturnType<S['parse']>;

export const health = (over: Partial<Of<typeof HealthResponseSchema>> = {}) =>
  exact(HealthResponseSchema, {
    services: [
      { name: 'api', up: true, latencyMs: 2, detail: null },
      { name: 'database', up: true, latencyMs: 4, detail: null },
      { name: 'graphhopper', up: false, latencyMs: null, detail: 'connect ECONNREFUSED' },
    ],
    osmDataDate: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    system: { ts: new Date().toISOString(), cpuPct: 37.4, memUsedBytes: 1.5 * 1024 ** 3, memTotalBytes: 2 * 1024 ** 3, diskUsedBytes: 5.6 * 1024 ** 3, diskTotalBytes: 14 * 1024 ** 3 },
    ...over,
  });

export const usage = (over: Partial<Of<typeof UsageStatsSchema>> = {}) =>
  exact(UsageStatsSchema, {
    totalUsers: 7,
    signupsByDay: [{ day: '2026-09-20', count: 2 }],
    dau: 3,
    wau: 5,
    tripsByDay: [{ day: '2026-09-20', car: 4, foot: 1 }],
    routesByKind: [{ kind: 'explore', count: 12 }],
    trackingOptInPct: 57,
    exploredKm2Total: 1234,
    exploredKm2Week: 56,
    ...over,
  });

export const metric = (over: Partial<MetricPoint> = {}): MetricPoint =>
  exact(MetricPointSchema, { bucket: new Date(Date.now() - 3600_000).toISOString(), metric: 'route', label: 'explore', count: 10, errorCount: 0, p50Ms: 400, p95Ms: 1800, maxMs: 2500, ...over });

export const errorGroup = (over: Partial<Of<typeof ErrorGroupSchema>> = {}) =>
  exact(ErrorGroupSchema, {
    message: 'Routing engine unreachable',
    service: 'api',
    source: 'POST /api/routes/explore',
    count: 4,
    lastSeen: new Date(Date.now() - 3600_000).toISOString(),
    latest: { id: 'e-1', createdAt: new Date().toISOString(), service: 'api', source: 'POST /api/routes/explore', message: 'Routing engine unreachable', stack: 'Error: Routing engine unreachable\n    at explore', requestId: 'req-1', userId: 'u-1' },
    ...over,
  });

export const jobs = (over: Partial<Of<typeof JobListSchema>> = {}) =>
  exact(JobListSchema, {
    queues: [
      { name: 'process-tracks', queued: 1, active: 0, failed: 2 },
      { name: 'mystery-queue', queued: 0, active: 0, failed: 0 },
    ],
    jobs: [{ id: 'j-1', name: 'process-tracks', state: 'failed', createdOn: new Date().toISOString(), completedOn: null, retryCount: 3, output: { message: 'boom' } }],
    ...over,
  });

export const pipelineRun = (over: Partial<Of<typeof PipelineRunSchema>> = {}) =>
  exact(PipelineRunSchema, { id: 'run-1', kind: 'osm_refresh', startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T02:00:00.000Z', status: 'succeeded', osmDataDate: '2026-08-31T20:00:00.000Z', logTail: '== graph done', ...over });

export const adminUser = (over: Partial<AdminUser> = {}): AdminUser =>
  exact(AdminUserSchema, {
    id: 'u-2',
    email: 'alex@example.test',
    role: 'user',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: null,
    disabledAt: null,
    deletedAt: null,
    tripCount: 12,
    roadCount: 345,
    settings: { trackingEnabled: true, defaultMode: 'foot', exploreBudgetMin: 20 },
    ...over,
  });

export const adminUserDetail = (over: Partial<AdminUser> = {}, sessions: unknown[] = []) =>
  exact(AdminUserDetailSchema, { ...adminUser(over), sessions });

export const invite = (over: Partial<Invite> = {}): Invite =>
  exact(InviteSchema, { code: 'ABCD-EFGH-JKLM', note: 'for Alex', roleOnSignup: 'user', createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'admin@example.test', expiresAt: '2026-09-15T00:00:00.000Z', usedAt: null, usedByEmail: null, revokedAt: null, status: 'unused', ...over });

export const auditEntry = (over: Partial<Of<typeof AuditEntrySchema>> = {}) =>
  exact(AuditEntrySchema, { id: 'a-1', createdAt: '2026-09-20T00:00:00.000Z', actorId: 'u-1', actorEmail: 'admin@example.test', action: 'user.view_trips', targetType: 'user', targetId: 'u-2-aaaaaaaa', details: {}, ip: null, ...over });

export const deletedItems = (over: Partial<Of<typeof DeletedItemsSchema>> = {}) =>
  exact(DeletedItemsSchema, {
    users: [{ id: 'u-3', email: 'gone@example.test', deletedAt: '2026-09-25T00:00:00.000Z', purgeAt: '2026-10-02T00:00:00.000Z' }],
    trips: [{ id: 't-9', userId: 'u-2', userEmail: 'alex@example.test', startedAt: '2026-09-20T00:00:00.000Z', deletedAt: '2026-09-25T00:00:00.000Z', purgeAt: '2026-10-02T00:00:00.000Z' }],
    ...over,
  });

export const feedbackItem = (over: Partial<FeedbackItem> = {}): FeedbackItem =>
  exact(FeedbackItemSchema, {
    id: 'f-1',
    type: 'bug',
    status: 'new',
    message: 'Explore routes do fifty U-turns',
    context: { screen: '/directions', platform: 'android', appVersion: '0.1.0', device: 'Pixel 8' },
    hasScreenshot: false,
    adminNotes: '',
    user: { id: 'u-2', email: 'alex@example.test' },
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...over,
  });
