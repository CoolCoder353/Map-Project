import type { FastifyInstance } from 'fastify';
import { MetricsAggregator, TokenService, createLogger, metricsWriter } from '@wayfinder/core';
import type { GraphHopperClient, RouteParams } from '@wayfinder/core';
import { type LngLat, destination } from '@wayfinder/shared';
import { buildApp } from '../../src/app.js';
import { type TestDb, createTestDb } from '../../../../packages/core/test/helpers/db.js';
import { FakeQueue, straightPath } from '../../../../packages/core/test/helpers/fakes.js';
import { makeUser } from '../../../../packages/core/test/helpers/users.js';

export { makeUser };

export interface TestApp {
  app: FastifyInstance;
  t: TestDb;
  queue: FakeQueue;
  metrics: MetricsAggregator;
  tokens: TokenService;
  ghDown: { value: boolean };
  retried: Array<{ name: string; id: string }>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const t = await createTestDb();
  const queue = new FakeQueue();
  const metrics = new MetricsAggregator(metricsWriter(t.db));
  const tokens = new TokenService('z'.repeat(40));
  const ghDown = { value: false };
  const graphhopper = {
    async route(p: RouteParams) {
      if (ghDown.value) throw new Error('boom: engine exploded');
      return [straightPath(p.points, 15)];
    },
    async isochrone(point: LngLat, _profile: string, s: number) {
      return [Array.from({ length: 13 }, (_, i) => destination(point, i * 30, s * 15))];
    },
    async health() {
      return ghDown.value ? { up: false, latencyMs: null, detail: 'down' } : { up: true, latencyMs: 2, detail: null };
    },
    async dataDate() {
      return '2026-09-01';
    },
  } as unknown as GraphHopperClient;
  const retried: Array<{ name: string; id: string }> = [];
  const app = await buildApp({
    ctx: {
      db: t.db,
      tokens,
      graphhopper,
      metrics,
      queue,
      log: createLogger('api-test', 'silent'),
      config: { publicWebUrl: 'https://maps.test', service: 'api' },
    },
    config: {
      CORS_ORIGINS: 'https://maps.test',
      COOKIE_SECURE: false,
      TRUST_PROXY: false,
      MAP_ASSETS_DIR: '/nonexistent',
      RATE_LIMIT_PER_MIN: 100_000,
      AUTH_RATE_LIMIT_PER_MIN: 100_000,
      NODE_ENV: 'test',
    },
    tiles: null,
    jobs: { retry: async (name, id) => void retried.push({ name, id }) },
  });
  await app.ready();
  return {
    app,
    t,
    queue,
    metrics,
    tokens,
    ghDown,
    retried,
    async close() {
      await app.close();
      await t.close();
    },
  };
}

export async function tokenFor(ta: TestApp, user: { id: string }, role: 'user' | 'dev' | 'admin') {
  return `Bearer ${await ta.tokens.signAccess({ sub: user.id, role })}`;
}
