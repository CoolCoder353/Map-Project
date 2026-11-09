import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { roadFactsService } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';
import { SIGNAL_TILE_MAX_ZOOM, SIGNAL_TILE_MIN_ZOOM, encodeSignalTile, tileBounds } from '../signal-tiles.js';

/** Absolute origin of this request as seen by the client (honours X-Forwarded-* behind Caddy). */
export const mapRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const configured = deps.config.PUBLIC_ORIGIN?.replace(/\/+$/, '');
    const originOf = (req: FastifyRequest) => configured ?? `${req.protocol}://${req.host}`;
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

    // Traffic lights, from the database rather than the tile file.
    app.get<{ Params: { z: string; x: string; y: string } }>('/tiles/signals/:z/:x/:y.mvt', tileLimit, async (req, reply) => {
      const [z, x, y] = [Number(req.params.z), Number(req.params.x), Number(req.params.y)];
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > SIGNAL_TILE_MAX_ZOOM || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
        return reply.status(400).send({ error: { code: 'bad_request', message: 'Invalid tile coordinates' } });
      }
      // Lights change with the map data, monthly at most; an hour's caching is plenty fresh.
      reply.header('cache-control', 'public, max-age=3600');
      if (z < SIGNAL_TILE_MIN_ZOOM) return reply.status(204).send();
      const signals = await roadFactsService.signalsIn(deps.ctx.db, tileBounds(z, x, y), 5000);
      if (signals.length === 0) return reply.status(204).send();
      reply.header('content-type', 'application/vnd.mapbox-vector-tile');
      return reply.send(Buffer.from(encodeSignalTile(signals, z, x, y)));
    });

    // Style JSON with absolute URLs for this deployment.
    // `driving=1`: the map for directions, without buildings, place dots and light markers.
    app.get<{ Querystring: { theme?: string; driving?: string } }>('/map/style.json', tileLimit, async (req, reply) => {
      const theme = req.query.theme === 'dark' ? 'dark' : 'light';
      const { buildStyle } = await import('../style.js');
      reply.header('cache-control', 'public, max-age=300');
      return buildStyle(originOf(req), theme, { driving: req.query.driving === '1' });
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
