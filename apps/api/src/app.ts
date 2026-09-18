import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { AppError, recordErrorEvent } from '@wayfinder/core';
import type { AppDeps } from './deps.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { coverageRoutes } from './routes/coverage.js';
import { feedbackRoutes } from './routes/feedback.js';
import { healthRoutes } from './routes/health.js';
import { mapRoutes } from './routes/map.js';
import { meRoutes } from './routes/me.js';
import { placeRoutes } from './routes/places.js';
import { routingRoutes } from './routes/routing.js';
import { trackRoutes } from './routes/tracks.js';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.ctx.log as unknown as FastifyBaseLogger,
    trustProxy: deps.config.TRUST_PROXY,
    bodyLimit: 5 * 1024 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Built-in metrics: per route template, never raw URLs (which may contain ids or coordinates).
  app.addHook('onResponse', async (req, reply) => {
    const template = req.routeOptions.url ?? 'unmatched';
    deps.ctx.metrics.record('http.request', `${req.method} ${template}`, reply.elapsedTime, reply.statusCode >= 500);
  });

  await app.register(cors, {
    origin: deps.config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: deps.config.RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    enableDraftSpec: true,
  });

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message } });
    }
    req.log.error({ err }, 'unhandled error');
    await recordErrorEvent(deps.ctx.db, {
      service: 'api',
      source: `${req.method} ${req.routeOptions.url ?? 'unmatched'}`,
      error: err,
      requestId: req.id,
      userId: req.user?.id ?? null,
    }).catch(() => undefined);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong', details: { requestId: req.id } } });
  });

  app.setNotFoundHandler(async (_req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  );

  await app.register(healthRoutes(deps), { prefix: '/api' });
  await app.register(authRoutes(deps), { prefix: '/api/auth' });
  await app.register(meRoutes(deps), { prefix: '/api/me' });
  await app.register(placeRoutes(deps), { prefix: '/api' });
  await app.register(routingRoutes(deps), { prefix: '/api' });
  await app.register(trackRoutes(deps), { prefix: '/api' });
  await app.register(coverageRoutes(deps), { prefix: '/api/coverage' });
  await app.register(feedbackRoutes(deps), { prefix: '/api' });
  await app.register(adminRoutes(deps), { prefix: '/api/admin' });
  await app.register(mapRoutes(deps));
  return app;
}
