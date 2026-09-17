import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  BBoxQuerySchema,
  CreateInvitesSchema,
  DiscoverQuerySchema,
  ExploreRouteRequestSchema,
  RegisterRequestSchema,
  TrackBatchRequestSchema,
} from '../src/schemas/index.js';

describe('schemas', () => {
  it('normalises email and enforces password length', () => {
    const ok = RegisterRequestSchema.parse({ inviteCode: 'ABCD-1234', email: ' Sam@Example.COM ', password: 'correct horse' });
    expect(ok.email).toBe('sam@example.com');
    expect(RegisterRequestSchema.safeParse({ inviteCode: 'ABCD', email: 'a@b.co', password: 'short' }).success).toBe(false);
  });

  it('parses bbox query strings', () => {
    expect(BBoxQuerySchema.parse('149,-35.4,149.2,-35.2')).toEqual([149, -35.4, 149.2, -35.2]);
    expect(BBoxQuerySchema.safeParse('149.2,-35.4,149,-35.2').success).toBe(false);
    expect(BBoxQuerySchema.safeParse('a,b').success).toBe(false);
  });

  it('validates route requests', () => {
    expect(ExploreRouteRequestSchema.safeParse({ from: [149, -35], to: [149.1, -35.1], mode: 'car' }).success).toBe(true);
    expect(ExploreRouteRequestSchema.safeParse({ from: [200, -35], to: [149.1, -35.1], mode: 'car' }).success).toBe(false);
    expect(ExploreRouteRequestSchema.safeParse({ from: [149, -35], to: [149.1, -35.1], mode: 'bike' }).success).toBe(false);
  });

  it('parses discover categories', () => {
    const q = DiscoverQuerySchema.parse({ lon: '149', lat: '-35', mode: 'foot', categories: 'park,cafe' });
    expect(q.categories).toEqual(['park', 'cafe']);
    expect(q.maxMinutes).toBe(30);
    expect(DiscoverQuerySchema.safeParse({ lon: '149', lat: '-35', mode: 'foot', categories: 'casino' }).success).toBe(false);
  });

  it('requires uuid batch ids and bounded point counts', () => {
    const base = { batchId: randomUUID(), source: 'background', points: [{ ts: 1, lon: 149, lat: -35 }] };
    expect(TrackBatchRequestSchema.safeParse(base).success).toBe(true);
    expect(TrackBatchRequestSchema.safeParse({ ...base, batchId: 'nope' }).success).toBe(false);
    expect(TrackBatchRequestSchema.safeParse({ ...base, points: [] }).success).toBe(false);
  });

  it('applies invite defaults', () => {
    expect(CreateInvitesSchema.parse({})).toEqual({ count: 1, expiresInDays: 14, note: null, roleOnSignup: 'user' });
  });
});
