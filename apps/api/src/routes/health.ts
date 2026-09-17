import type { FastifyPluginAsync } from 'fastify';
import { opsService } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';

export const healthRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    // Public liveness/readiness for Docker and Caddy; no details beyond up/down.
    app.get('/health', { config: { rateLimit: false } }, async (_req, reply) => {
      const health = await opsService.checkHealth(deps.ctx.db, deps.ctx.graphhopper);
      const db = health.services.find((s) => s.name === 'database')?.up ?? false;
      const gh = health.services.find((s) => s.name === 'graphhopper')?.up ?? false;
      return reply.status(db ? 200 : 503).send({ status: db ? 'ok' : 'degraded', database: db, routing: gh });
    });
  };
