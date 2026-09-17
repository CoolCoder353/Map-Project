import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  LoginRequestSchema,
  MOBILE_CLIENT_HEADER,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
} from '@wayfinder/shared';
import { authService, parse, unauthorized } from '@wayfinder/core';
import type { AppDeps } from '../deps.js';

export const REFRESH_COOKIE = 'wf_refresh';

export const authRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { db, tokens } = deps.ctx;
    const isMobile = (req: FastifyRequest) => req.headers[MOBILE_CLIENT_HEADER] === 'mobile';
    const limited = { config: { rateLimit: { max: deps.config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } };

    const send = (req: FastifyRequest, reply: FastifyReply, result: Awaited<ReturnType<typeof authService.login>>) => {
      if (isMobile(req)) return { ...result.response, refreshToken: result.tokens.refreshToken };
      reply.setCookie(REFRESH_COOKIE, result.tokens.refreshToken, {
        httpOnly: true,
        secure: deps.config.COOKIE_SECURE,
        sameSite: 'strict',
        path: '/api/auth',
        expires: result.tokens.refreshExpiresAt,
      });
      return result.response;
    };

    app.post('/register', limited, async (req, reply) => {
      const body = parse(RegisterRequestSchema, req.body);
      const result = await authService.register(db, tokens, body, req.headers['user-agent'] ?? null);
      reply.status(201);
      return send(req, reply, result);
    });

    app.post('/login', limited, async (req, reply) => {
      const body = parse(LoginRequestSchema, req.body);
      const result = await authService.login(db, tokens, body.email, body.password, req.headers['user-agent'] ?? null);
      return send(req, reply, result);
    });

    const readRefresh = (req: FastifyRequest) => {
      const body = parse(RefreshRequestSchema, req.body ?? {});
      return body.refreshToken ?? req.cookies[REFRESH_COOKIE];
    };

    app.post('/refresh', limited, async (req, reply) => {
      const token = readRefresh(req);
      if (!token) throw unauthorized('Session expired');
      try {
        const result = await authService.refresh(db, tokens, token, req.headers['user-agent'] ?? null);
        return send(req, reply, result);
      } catch (err) {
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
        throw err;
      }
    });

    app.post('/logout', async (req, reply) => {
      const token = readRefresh(req);
      if (token) await authService.logout(db, token);
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      return { ok: true };
    });

    app.post('/reset-password', limited, async (req) => {
      const body = parse(ResetPasswordRequestSchema, req.body);
      await authService.resetPassword(db, body.token, body.password);
      return { ok: true };
    });
  };
