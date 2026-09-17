import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inviteService } from '@wayfinder/core';
import { type TestApp, createTestApp } from '../helpers/app.js';

let ta: TestApp;
beforeAll(async () => {
  ta = await createTestApp();
});
afterAll(async () => {
  await ta?.close();
});

const cookieFrom = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw];
  return (list.find((c) => String(c).startsWith('wf_refresh=')) as string | undefined)?.split(';')[0];
};

describe('auth API', () => {
  it('web flow: register sets an httpOnly refresh cookie; refresh rotates it; logout clears it', async () => {
    const [code] = await inviteService.createInvites(ta.t.db, { count: 1, expiresInDays: 1, note: null, roleOnSignup: 'user', createdBy: null });
    const reg = await ta.app.inject({ method: 'POST', url: '/api/auth/register', payload: { inviteCode: code, email: 'web@example.com', password: 'web password 1' } });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().refreshToken).toBeUndefined();
    const setCookie = String(([] as unknown[]).concat(reg.headers['set-cookie'])[0]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/);
    const cookie = cookieFrom(reg)!;

    const me = await ta.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${reg.json().accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('web@example.com');

    const refreshed = await ta.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } });
    expect(refreshed.statusCode).toBe(200);
    const cookie2 = cookieFrom(refreshed)!;
    expect(cookie2).not.toBe(cookie);

    const out = await ta.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookie2 } });
    expect(out.statusCode).toBe(200);
    const again = await ta.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: cookie2 } });
    expect(again.statusCode).toBe(401);
  });

  it('mobile flow returns the refresh token in the body', async () => {
    const res = await ta.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-client': 'mobile' },
      payload: { email: 'web@example.com', password: 'web password 1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const rt = res.json().refreshToken;
    const r2 = await ta.app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { 'x-client': 'mobile' }, payload: { refreshToken: rt } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().refreshToken).not.toBe(rt);
  });

  it('validates input and hides internal details', async () => {
    const bad = await ta.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nope' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');
    const noAuth = await ta.app.inject({ method: 'GET', url: '/api/trips' });
    expect(noAuth.statusCode).toBe(401);
    const junk = await ta.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer junk' } });
    expect(junk.statusCode).toBe(401);
    expect(junk.headers['x-request-id']).toBeTruthy();
  });

  it('settings update and self-deletion (soft) with confirmation', async () => {
    const login = await ta.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'web@example.com', password: 'web password 1' } });
    const auth = { authorization: `Bearer ${login.json().accessToken}` };
    const patched = await ta.app.inject({ method: 'PATCH', url: '/api/me/settings', headers: auth, payload: { trackingEnabled: true, exploreBudgetMin: 25 } });
    expect(patched.json().settings).toEqual({ trackingEnabled: true, defaultMode: 'car', exploreBudgetMin: 25 });
    const exp = await ta.app.inject({ method: 'GET', url: '/api/me/export', headers: auth });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/attachment/);
    expect(exp.json().trips.type).toBe('FeatureCollection');
    const wrong = await ta.app.inject({ method: 'DELETE', url: '/api/me', headers: auth, payload: { confirm: 'x' } });
    expect(wrong.statusCode).toBe(400);
    const del = await ta.app.inject({ method: 'DELETE', url: '/api/me', headers: auth, payload: { confirm: 'web@example.com' } });
    expect(del.statusCode).toBe(200);
    const after = await ta.app.inject({ method: 'GET', url: '/api/me', headers: auth });
    expect(after.statusCode).toBe(401);
  });
});
