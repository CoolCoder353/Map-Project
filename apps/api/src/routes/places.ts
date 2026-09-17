import type { FastifyPluginAsync } from 'fastify';
import {
  PlannedRouteCreateSchema,
  ReverseQuerySchema,
  SearchQuerySchema,
} from '@wayfinder/shared';
import { parse, placeService } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';

export const placeRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));
    const { db, metrics } = deps.ctx;

    app.get('/search', async (req) => {
      const q = parse(SearchQuerySchema, req.query);
      const near = q.lon !== undefined && q.lat !== undefined ? ([q.lon, q.lat] as [number, number]) : null;
      const results = await metrics.time('search', 'forward', () => placeService.searchPlaces(db, q.q, near, q.limit));
      return { results };
    });

    app.get('/reverse', async (req) => {
      const q = parse(ReverseQuerySchema, req.query);
      return { place: await placeService.reverseGeocode(db, [q.lon, q.lat]) };
    });

    app.get('/planned-routes', async (req) => ({ items: await placeService.listPlannedRoutes(db, currentUser(req).id) }));

    app.post('/planned-routes', async (req, reply) => {
      const body = parse(PlannedRouteCreateSchema, req.body);
      reply.status(201);
      return placeService.createPlannedRoute(db, currentUser(req).id, body.name, body.route);
    });

    app.delete<{ Params: { id: string } }>('/planned-routes/:id', async (req) => {
      await placeService.deletePlannedRoute(db, currentUser(req).id, req.params.id);
      return { ok: true };
    });
  };
