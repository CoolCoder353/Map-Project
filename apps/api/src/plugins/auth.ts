import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@wayfinder/shared';
import { type CoreContext, type UserRow, findUserById, forbidden, isActive, notFound, unauthorized } from '@wayfinder/core';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

/** Verify the bearer token and load the current user (role and status are always read from the DB). */
export function authenticate(ctx: CoreContext) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let sub: string;
    let iat: number;
    try {
      ({ sub, iat } = await ctx.tokens.verifyAccess(header.slice(7)));
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await findUserById(ctx.db, sub);
    if (!user || !isActive(user)) throw unauthorized('Invalid or expired token');
    // Tokens issued before a password change are no longer valid.
    if (iat * 1000 < user.password_changed_at.getTime() - 1000) throw unauthorized('Invalid or expired token');
    req.user = user;
    if (!user.last_seen_at || Date.now() - user.last_seen_at.getTime() > LAST_SEEN_THROTTLE_MS) {
      void ctx.db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]).catch(() => undefined);
    }
  };
}

/**
 * Gate for /admin: normal users get 404 (the dashboard's existence isn't revealed);
 * users without a sufficient staff role get 403.
 */
export function requireRole(minimum: Extract<Role, 'dev' | 'admin'>) {
  return async (req: FastifyRequest) => {
    const role = req.user?.role;
    if (!role || role === 'user') throw notFound();
    if (minimum === 'admin' && role !== 'admin') throw forbidden('Admin role required');
  };
}

export function currentUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}
