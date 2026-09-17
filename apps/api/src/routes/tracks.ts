import type { FastifyPluginAsync } from 'fastify';
import { PageQuerySchema, TrackBatchRequestSchema, UpdateTripSchema } from '@wayfinder/shared';
import { parse, trackService } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';

export const trackRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));
    const { db, queue } = deps.ctx;

    app.post('/tracks/batches', async (req, reply) => {
      const body = parse(TrackBatchRequestSchema, req.body);
      const result = await trackService.ingestBatch(db, queue, currentUser(req).id, body);
      reply.status(result.duplicate ? 200 : 202);
      return result;
    });

    app.get('/trips', async (req) => {
      const q = parse(PageQuerySchema, req.query);
      return trackService.listTrips(db, currentUser(req).id, q.limit, q.cursor);
    });

    app.get<{ Params: { id: string } }>('/trips/:id', async (req) => trackService.getTrip(db, currentUser(req).id, req.params.id));

    app.patch<{ Params: { id: string } }>('/trips/:id', async (req) => {
      const body = parse(UpdateTripSchema, req.body);
      await trackService.updateTripMode(db, queue, currentUser(req).id, req.params.id, body.mode);
      return { ok: true };
    });

    app.delete<{ Params: { id: string } }>('/trips/:id', async (req) => {
      await trackService.softDeleteTrip(db, queue, currentUser(req).id, req.params.id);
      return { ok: true };
    });
  };
