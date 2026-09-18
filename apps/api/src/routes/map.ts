import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppDeps } from '../deps.js';

/** Absolute origin of this request as seen by the client (honours X-Forwarded-* behind Caddy). */
const originOf = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

export const mapRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const assets = resolve(deps.config.MAP_ASSETS_DIR);
    const tileLimit = { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } };

    app.get('/tiles/tiles.json', tileLimit, async (req, reply) => {
      if (!deps.tiles || !(await deps.tiles.available())) {
        // 404 rather than 503: an expected state before the first data refresh, not an outage.
        return reply.status(404).send({ error: { code: 'tiles_not_built', message: 'Map tiles not built yet' } });
      }
      reply.header('cache-control', 'public, max-age=300');
      return deps.tiles.tileJson(`${originOf(req)}/tiles/{z}/{x}/{y}.mvt`);
    });

    app.get<{ Params: { z: string; x: string; y: string } }>('/tiles/:z/:x/:y.mvt', tileLimit, async (req, reply) => {
      if (!deps.tiles || !(await deps.tiles.available())) return reply.status(404).send();
      const [z, x, y] = [Number(req.params.z), Number(req.params.x), Number(req.params.y)];
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
        return reply.status(400).send({ error: { code: 'bad_request', message: 'Invalid tile coordinates' } });
      }
      const tile = await deps.tiles.getTile(z, x, y);
      reply.header('cache-control', 'public, max-age=86400');
      if (!tile) return reply.status(204).send();
      reply.header('content-type', 'application/vnd.mapbox-vector-tile');
      // Sent uncompressed; Caddy compresses responses on the way out.
      return reply.send(Buffer.from(tile));
    });

    // Style JSON with absolute URLs for this deployment.
    app.get<{ Querystring: { theme?: string } }>('/map/style.json', tileLimit, async (req, reply) => {
      const theme = req.query.theme === 'dark' ? 'dark' : 'light';
      const { buildStyle } = await import('../style.js');
      reply.header('cache-control', 'public, max-age=300');
      return buildStyle(originOf(req), theme);
    });

    if (existsSync(assets)) {
      await app.register(fastifyStatic, {
        root: assets,
        prefix: '/map/assets/',
        decorateReply: false,
        maxAge: '7d',
        // Glyph ranges are protobuf; a specific type lets Caddy compress them.
        setHeaders: (res, path) => {
          if (path.endsWith('.pbf')) res.header('content-type', 'application/x-protobuf');
        },
      });
    }
  };
