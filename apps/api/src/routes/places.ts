import type { FastifyPluginAsync } from 'fastify';
import {
  PlannedRouteCreateSchema,
  ReverseQuerySchema,
  SavedPlaceSaveSchema,
  SearchQuerySchema,
  haversineM,
} from '@wayfinder/shared';
import { parse, placeService, savedPlaceService } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';

/** A found place this close to a saved one is taken to be the same place. */
const SAME_PLACE_M = 30;

export const placeRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));
    const { db, metrics } = deps.ctx;

    app.get('/search', async (req) => {
      const q = parse(SearchQuerySchema, req.query);
      const near = q.lon !== undefined && q.lat !== undefined ? ([q.lon, q.lat] as [number, number]) : null;
      const [saved, found] = await Promise.all([
        savedPlaceService.matchingSavedPlaces(db, currentUser(req).id, q.q, near),
        metrics.time('search', 'forward', () => placeService.searchPlaces(db, q.q, near, q.limit)),
      ]);
      // Your own "Home" before every other place called home, but never all of the room, and not
      // alongside the very place it was saved from.
      const mine = saved.slice(0, Math.max(1, Math.floor(q.limit / 2)));
      const others = found.filter((f) => !mine.some((m) => haversineM(m.location, f.location) < SAME_PLACE_M));
      return { results: [...mine, ...others].slice(0, q.limit) };
    });

    app.get('/reverse', async (req) => {
      const q = parse(ReverseQuerySchema, req.query);
      return { place: await placeService.reverseGeocode(db, [q.lon, q.lat]) };
    });

    app.get('/saved-places', async (req) => ({ items: await savedPlaceService.listSavedPlaces(db, currentUser(req).id) }));

    app.post('/saved-places', async (req) => savedPlaceService.saveSavedPlace(db, currentUser(req).id, parse(SavedPlaceSaveSchema, req.body)));

    app.delete<{ Params: { id: string } }>('/saved-places/:id', async (req) => {
      await savedPlaceService.deleteSavedPlace(db, currentUser(req).id, req.params.id);
      return { ok: true };
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
