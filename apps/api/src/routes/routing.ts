import type { FastifyPluginAsync } from 'fastify';
import {
  DiscoverQuerySchema,
  ExploreRouteRequestSchema,
  FastestRouteRequestSchema,
  RoundTripRequestSchema,
} from '@wayfinder/shared';
import { parse, routingService } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';

export const routingRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));
    const r = { db: deps.ctx.db, graphhopper: deps.ctx.graphhopper, metrics: deps.ctx.metrics };

    app.post('/routes/fastest', async (req) => {
      const body = parse(FastestRouteRequestSchema, req.body);
      return deps.ctx.metrics.time('route', 'fastest', () => routingService.fastestRoute(r, currentUser(req).id, body));
    });

    app.post('/routes/explore', async (req) => {
      const body = parse(ExploreRouteRequestSchema, req.body);
      const user = currentUser(req);
      const budgetMin = body.budgetMin ?? (user.settings.exploreBudgetMin as number | undefined);
      return deps.ctx.metrics.time('route', 'explore', () =>
        routingService.exploreRoutes(r, user.id, { from: body.from, to: body.to, mode: body.mode, budgetMin }),
      );
    });

    app.post('/routes/roundtrip', async (req) => {
      const body = parse(RoundTripRequestSchema, req.body);
      const routes = await deps.ctx.metrics.time('route', 'roundtrip', () =>
        routingService.roundTrips(r, currentUser(req).id, body),
      );
      return { routes };
    });

    app.get('/discover', async (req) => {
      const q = parse(DiscoverQuerySchema, req.query);
      const items = await deps.ctx.metrics.time('route', 'discover', () => routingService.discover(r, currentUser(req).id, q));
      return { items };
    });
  };
