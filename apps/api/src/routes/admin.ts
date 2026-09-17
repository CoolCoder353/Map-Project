import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  AdminUpdateUserSchema,
  AdminUserListQuerySchema,
  AuditQuerySchema,
  ConfirmBodySchema,
  CoverageQuerySchema,
  CreateInvitesSchema,
  ErrorListQuerySchema,
  InviteListQuerySchema,
  JobListQuerySchema,
  MetricsQuerySchema,
  PageQuerySchema,
} from '@wayfinder/shared';
import {
  AppError,
  adminService,
  audit,
  authService,
  badRequest,
  coverageService,

  inviteService,
  notFound,
  opsService,
  parse,
  trackService,
} from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser, requireRole } from '../plugins/auth.js';

export const adminRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { db, queue, graphhopper } = deps.ctx;
    app.addHook('preHandler', authenticate(deps.ctx));
    app.addHook('preHandler', requireRole('dev'));
    const adminOnly = { preHandler: requireRole('admin') };
    const actor = (req: FastifyRequest) => ({ id: currentUser(req).id, ip: req.ip ?? null });
    const auditView = (req: FastifyRequest, action: string, targetId: string, details?: Record<string, unknown>) =>
      audit(db, { actorId: currentUser(req).id, action, targetType: 'user', targetId, ip: req.ip, ...(details ? { details } : {}) });

    // ---- Monitoring ----
    app.get('/health', async () => opsService.checkHealth(db, graphhopper));
    app.get('/metrics', async (req) => ({ points: await adminService.queryMetrics(db, parse(MetricsQuerySchema, req.query)) }));
    app.get<{ Querystring: { hours?: string } }>('/system', async (req) => ({
      samples: await opsService.listSystemSamples(db, Math.min(24 * 30, Math.max(1, Number(req.query.hours ?? 24) || 24))),
    }));
    app.get('/errors', async (req) => ({ groups: await adminService.listErrorGroups(db, parse(ErrorListQuerySchema, req.query)) }));
    app.get('/jobs', async (req) => opsService.listJobs(db, parse(JobListQuerySchema, req.query).state));
    app.post<{ Params: { name: string; id: string } }>('/jobs/:name/:id/retry', adminOnly, async (req) => {
      await deps.jobs.retry(req.params.name, req.params.id);
      await audit(db, { actorId: currentUser(req).id, action: 'job.retry', targetType: 'job', targetId: req.params.id, details: { name: req.params.name }, ip: req.ip });
      return { ok: true };
    });
    app.get('/pipeline/runs', async () => ({ items: await opsService.listPipelineRuns(db) }));
    app.post('/pipeline/refresh', adminOnly, async (req, reply) => {
      const { confirm } = parse(ConfirmBodySchema, req.body);
      if (confirm !== 'REFRESH') throw new AppError(400, 'confirmation_required', 'Type REFRESH to confirm');
      let runId: string;
      try {
        runId = await opsService.createPipelineRun(db, 'osm_refresh', currentUser(req).id);
      } catch (err) {
        if ((err as { code?: string }).code === 'busy') throw new AppError(409, 'busy', (err as Error).message);
        throw err;
      }
      await queue.send('osm-refresh', { runId }, { singletonKey: 'osm-refresh' });
      await audit(db, { actorId: currentUser(req).id, action: 'pipeline.refresh', targetType: 'pipeline', targetId: runId, ip: req.ip });
      reply.status(202);
      return { id: runId };
    });
    app.get('/stats/usage', async () => adminService.usageStats(db));

    // ---- Users ----
    app.get('/users', async (req) => adminService.listUsers(db, parse(AdminUserListQuerySchema, req.query)));
    app.get<{ Params: { id: string } }>('/users/:id', async (req) => {
      const user = await adminService.getAdminUser(db, req.params.id);
      await auditView(req, 'user.view', user.id);
      return user;
    });
    app.get<{ Params: { id: string } }>('/users/:id/trips', async (req) => {
      const target = await adminService.getAdminUser(db, req.params.id);
      const q = parse(PageQuerySchema, req.query);
      await auditView(req, 'user.view_trips', target.id);
      return trackService.listTrips(db, target.id, q.limit, q.cursor);
    });
    app.get<{ Params: { id: string; tripId: string } }>('/users/:id/trips/:tripId', async (req) => {
      const trip = await trackService.getTrip(db, req.params.id, req.params.tripId, true);
      await auditView(req, 'user.view_trip', req.params.id, { tripId: trip.id });
      return trip;
    });
    app.get<{ Params: { id: string } }>('/users/:id/coverage', async (req) => {
      const target = await adminService.getAdminUser(db, req.params.id);
      const q = parse(CoverageQuerySchema, req.query);
      await auditView(req, 'user.view_coverage', target.id);
      return coverageService.getCoverage(db, target.id, q.bbox, q.zoom);
    });
    app.get<{ Params: { id: string } }>('/users/:id/coverage/stats', async (req) => {
      const target = await adminService.getAdminUser(db, req.params.id);
      await auditView(req, 'user.view_coverage', target.id);
      return coverageService.getCoverageStats(db, target.id);
    });

    app.patch<{ Params: { id: string } }>('/users/:id', adminOnly, async (req) => {
      const body = parse(AdminUpdateUserSchema, req.body);
      return adminService.updateUserAsAdmin(db, actor(req), req.params.id, body);
    });
    app.post<{ Params: { id: string } }>('/users/:id/revoke-sessions', adminOnly, async (req) => {
      const target = await adminService.getAdminUser(db, req.params.id);
      const revoked = await authService.revokeAllSessions(db, target.id);
      await audit(db, { actorId: currentUser(req).id, action: 'user.revoke_sessions', targetType: 'user', targetId: target.id, details: { revoked }, ip: req.ip });
      return { revoked };
    });
    app.post<{ Params: { id: string } }>('/users/:id/reset-password-link', adminOnly, async (req) => {
      const target = await adminService.getAdminUser(db, req.params.id);
      if (target.deletedAt) throw notFound('User not found');
      const link = await authService.createPasswordResetLink(db, target.id, currentUser(req).id, deps.ctx.config.publicWebUrl);
      await audit(db, { actorId: currentUser(req).id, action: 'user.reset_link', targetType: 'user', targetId: target.id, ip: req.ip });
      return { url: link.url, expiresAt: link.expiresAt.toISOString() };
    });
    app.delete<{ Params: { id: string } }>('/users/:id', adminOnly, async (req) => {
      const { confirm } = parse(ConfirmBodySchema, req.body);
      await adminService.softDeleteUser(db, actor(req), req.params.id, confirm);
      return { ok: true };
    });
    app.post<{ Params: { id: string } }>('/users/:id/restore', adminOnly, async (req) => {
      await adminService.restoreUser(db, actor(req), req.params.id);
      return { ok: true };
    });

    // ---- Data removal ----
    app.delete<{ Params: { id: string; tripId: string } }>('/users/:id/trips/:tripId', adminOnly, async (req) => {
      const { confirm } = parse(ConfirmBodySchema, req.body);
      if (confirm !== 'DELETE') throw new AppError(400, 'confirmation_required', 'Type DELETE to confirm');
      await trackService.softDeleteTrip(db, queue, req.params.id, req.params.tripId);
      await audit(db, { actorId: currentUser(req).id, action: 'trip.delete', targetType: 'user', targetId: req.params.id, details: { tripId: req.params.tripId }, ip: req.ip });
      return { ok: true };
    });
    app.post<{ Params: { tripId: string } }>('/trips/:tripId/restore', adminOnly, async (req) => {
      const userId = await trackService.restoreTrip(db, queue, req.params.tripId);
      await audit(db, { actorId: currentUser(req).id, action: 'trip.restore', targetType: 'user', targetId: userId, details: { tripId: req.params.tripId }, ip: req.ip });
      return { ok: true };
    });
    app.post<{ Params: { id: string } }>('/users/:id/coverage/rebuild', adminOnly, async (req) => {
      const target = await adminService.getAdminUser(db, req.params.id);
      await queue.send('rebuild-coverage', { userId: target.id }, { singletonKey: `rebuild-coverage:${target.id}` });
      await audit(db, { actorId: currentUser(req).id, action: 'coverage.rebuild', targetType: 'user', targetId: target.id, ip: req.ip });
      return { ok: true };
    });
    app.get('/deleted', async () => adminService.listDeleted(db));

    // ---- Invites ----
    app.get('/invites', async (req) => ({ items: await inviteService.listInvites(db, parse(InviteListQuerySchema, req.query).status) }));
    app.post('/invites', adminOnly, async (req, reply) => {
      const body = parse(CreateInvitesSchema, req.body ?? {});
      const codes = await inviteService.createInvites(db, { ...body, createdBy: currentUser(req).id });
      await audit(db, {
        actorId: currentUser(req).id,
        action: 'invite.create',
        targetType: 'invite',
        targetId: null,
        details: { count: codes.length, roleOnSignup: body.roleOnSignup, expiresInDays: body.expiresInDays, note: body.note },
        ip: req.ip,
      });
      reply.status(201);
      return { codes };
    });
    app.post<{ Params: { code: string } }>('/invites/:code/revoke', adminOnly, async (req) => {
      if (!(await inviteService.revokeInvite(db, req.params.code))) throw badRequest('Invite is already used or revoked');
      await audit(db, { actorId: currentUser(req).id, action: 'invite.revoke', targetType: 'invite', targetId: req.params.code, ip: req.ip });
      return { ok: true };
    });

    // ---- Audit ----
    app.get('/audit', async (req) => ({ items: await adminService.listAudit(db, parse(AuditQuerySchema, req.query)) }));

  };
