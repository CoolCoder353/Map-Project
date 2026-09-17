import type { FastifyPluginAsync } from 'fastify';
import { CoverageQuerySchema } from '@wayfinder/shared';
import { coverageService, parse } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { authenticate, currentUser } from '../plugins/auth.js';

export const coverageRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', authenticate(deps.ctx));

    app.get('/', async (req) => {
      const q = parse(CoverageQuerySchema, req.query);
      const cov = await coverageService.getCoverage(deps.ctx.db, currentUser(req).id, q.bbox, q.zoom);
      return q.format === 'geojson' ? coverageService.coverageToGeoJson(cov) : cov;
    });

    app.get('/stats', async (req) => coverageService.getCoverageStats(deps.ctx.db, currentUser(req).id));
  };
