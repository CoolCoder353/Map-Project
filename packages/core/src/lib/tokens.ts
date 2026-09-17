import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@wayfinder/shared';

export interface AccessClaims {
  sub: string;
  role: Role;
}

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600;

export class TokenService {
  private key: Uint8Array;
  constructor(secret: string) {
    if (secret.length < 32) throw new Error('JWT secret must be at least 32 characters');
    this.key = new TextEncoder().encode(secret);
  }

  signAccess(claims: AccessClaims, now = Date.now()): Promise<string> {
    return new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + ACCESS_TOKEN_TTL_S)
      .setIssuer('wayfinder')
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims & { iat: number }> {
    const { payload } = await jwtVerify(token, this.key, { issuer: 'wayfinder', algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') throw new Error('Bad token');
    return { sub: payload.sub, role: payload.role as Role, iat: payload.iat ?? 0 };
  }
}

/** Opaque random token (base64url) and its SHA-256 hash for storage. */
export function newOpaqueToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-friendly invite code like "K7QX-M2PA-9RTD". */
export function newInviteCode(): string {
  const bytes = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length];
    if (i === 3 || i === 7) s += '-';
  }
  return s;
}
