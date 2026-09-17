import type { FastifyPluginAsync } from 'fastify';
import { ConfirmBodySchema, UpdateSettingsSchema } from '@wayfinder/shared';
import { accountService, adminService, parse, toPublicUser, updateSettings } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';
import { REFRESH_COOKIE } from './auth.js';

export const meRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));

    app.get('/', async (req) => toPublicUser(currentUser(req)));

    app.patch('/settings', async (req) => {
      const patch = parse(UpdateSettingsSchema, req.body);
      return toPublicUser(await updateSettings(deps.ctx.db, currentUser(req).id, patch));
    });

    app.get('/export', async (req, reply) => {
      const user = currentUser(req);
      const data = await accountService.exportUserData(deps.ctx.db, user.id);
      reply.header('content-disposition', `attachment; filename="wayfinder-export-${new Date().toISOString().slice(0, 10)}.json"`);
      return data;
    });

    /** Delete own account (soft delete, purged after the retention window). Body: { confirm: email }. */
    app.delete('/', async (req, reply) => {
      const user = currentUser(req);
      const { confirm } = parse(ConfirmBodySchema, req.body);
      await adminService.softDeleteUser(deps.ctx.db, null, user.id, confirm);
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      return { ok: true };
    });
  };
