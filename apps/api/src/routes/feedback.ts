import type { FastifyPluginAsync } from 'fastify';
import { CarReportDetailsSchema, FeedbackCreateSchema } from '@wayfinder/shared';
import { feedbackService, parse } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';

export const feedbackRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));
    // A 2 MB screenshot is ~2.7 MB as base64.
    app.post('/feedback', { bodyLimit: 3 * 1024 * 1024 }, async (req, reply) => {
      const body = parse(FeedbackCreateSchema, req.body);
      const item = await feedbackService.createFeedback(deps.ctx.db, currentUser(req).id, body);
      reply.status(201);
      return { id: item.id };
    });
    // Your own one-tap reports from the car, and what was wrong added to one once it's safe.
    app.get('/feedback/car-reports', async (req) => ({ reports: await feedbackService.carReports(deps.ctx.db, currentUser(req).id) }));
    app.post<{ Params: { id: string } }>('/feedback/:id/details', { bodyLimit: 3 * 1024 * 1024 }, async (req, reply) => {
      const body = parse(CarReportDetailsSchema, req.body);
      await feedbackService.addCarReportDetails(deps.ctx.db, currentUser(req).id, req.params.id, body);
      reply.status(204);
    });
  };
