import type { FastifyPluginAsync } from 'fastify';
import { FeedbackCreateSchema } from '@wayfinder/shared';
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
  };
