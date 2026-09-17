import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/lib/apiClient';

const user = { id: 'u', email: 'a@b.co', role: 'user', createdAt: '', settings: { trackingEnabled: false, defaultMode: 'car', exploreBudgetMin: 15 } };

function fakeServer() {
  let access = 'A1';
  let refresh = 'R1';
  const calls: string[] = [];
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    const headers = init.headers as Record<string, string>;
    calls.push(`${init.method} ${path} ${headers.authorization ?? ''}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (headers['x-client'] !== 'mobile') return json(400, {});
    if (path === '/api/auth/login') return json(200, { accessToken: access, refreshToken: refresh, user });
    if (path === '/api/auth/refresh') {
      const body = JSON.parse(String(init.body)) as { refreshToken: string };
      if (body.refreshToken !== refresh) return json(401, { error: { code: 'unauthorized', message: 'Session expired' } });
      access = 'A2';
      refresh = 'R2';
      return json(200, { accessToken: access, refreshToken: refresh, user });
    }
    if (headers.authorization !== `Bearer ${access}`) return json(401, { error: { code: 'unauthorized', message: 'no' } });
    return json(200, { ok: true });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, expireAccess: () => (access = 'EXPIRED'), revoke: () => (refresh = 'GONE') };
}

describe('mobile API client', () => {
  it('logs in, stores the refresh token, and transparently refreshes an expired access token', async () => {
    const srv = fakeServer();
    let stored: string | null = null;
    const sessions: Array<string | null> = [];
    const api = createApiClient({
      baseUrl: async () => 'https://maps.test',
      fetch: srv.fetchImpl,
      tokens: { getRefreshToken: async () => stored, setRefreshToken: async (t) => void (stored = t) },
      onSession: (a) => sessions.push(a?.accessToken ?? null),
    });
    await api.login('a@b.co', 'pw');
    expect(stored).toBe('R1');
    srv.expireAccess();
    await expect(api.request('/api/me')).resolves.toEqual({ ok: true });
    expect(stored).toBe('R2');
    expect(sessions).toEqual(['A1', 'A2']);
  });

  it('ends the session when the refresh token is rejected', async () => {
    const srv = fakeServer();
    let stored: string | null = 'OLD';
    const sessions: Array<string | null> = [];
    const api = createApiClient({
      baseUrl: async () => 'https://maps.test',
      fetch: srv.fetchImpl,
      tokens: { getRefreshToken: async () => stored, setRefreshToken: async (t) => void (stored = t) },
      onSession: (a) => sessions.push(a?.accessToken ?? null),
    });
    await expect(api.request('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(stored).toBeNull();
    expect(sessions).toEqual([null]);
  });
});
