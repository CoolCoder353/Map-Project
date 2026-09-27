import { describe, expect, it } from 'vitest';
import { CoverageStatsSchema } from '@wayfinder/shared/schemas';
import { createApiClient, isServerUrl, normaliseServerUrl } from '../src/lib/apiClient';

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

  it('names the server it could not reach, so a wrong address is obvious', async () => {
    const api = createApiClient({
      baseUrl: async () => 'https://maps.example.com',
      fetch: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
      tokens: { getRefreshToken: async () => null, setRefreshToken: async () => undefined },
    });
    await expect(api.request('/api/config')).rejects.toThrow(/maps\.example\.com/);
  });

  it('passes a cancelled request through instead of blaming the server', async () => {
    const api = createApiClient({
      baseUrl: async () => 'https://maps.test',
      fetch: (async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }) as unknown as typeof fetch,
      tokens: { getRefreshToken: async () => null, setRefreshToken: async () => undefined },
    });
    await expect(api.request('/api/search')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('asks for a server address when the build has none, rather than failing on an invalid URL', async () => {
    const api = createApiClient({
      baseUrl: async () => '',
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      tokens: { getRefreshToken: async () => null, setRefreshToken: async () => undefined },
    });
    await expect(api.request('/api/config')).rejects.toThrow(/No server address set/);
  });

  const client = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>, base = 'https://maps.test') =>
    createApiClient({
      baseUrl: async () => base,
      fetch: fetchImpl as unknown as typeof fetch,
      tokens: { getRefreshToken: async () => null, setRefreshToken: async () => undefined },
    });

  it('gives up on a server that never answers, and says so', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await expect(client(hang).request('/api/search', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout', message: expect.stringMatching(/maps\.test took too long/) });
  });

  it('still passes a caller’s cancellation through while a timeout is armed', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const ctrl = new AbortController();
    const pending = client(hang).request('/api/search', { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('explains a page that isn’t JSON (a Wi-Fi login page, the wrong server) instead of a parse error', async () => {
    const api = client(async () => new Response('<html>Sign in to Airport Wi-Fi</html>', { status: 200 }));
    await expect(api.request('/api/config')).rejects.toMatchObject({ code: 'bad_response', message: expect.stringMatching(/couldn’t read/) });
  });

  it('treats an empty success as no content', async () => {
    await expect(client(async () => new Response('', { status: 200 })).request('/api/trips/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('says a bare 404 means the address is wrong, and keeps the API’s own 404 messages', async () => {
    await expect(client(async () => new Response('Not Found', { status: 404 })).request('/api/config')).rejects.toThrow(/doesn’t look like your group’s server/);
    const api = client(async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'Trip not found' } }), { status: 404 }));
    await expect(api.request('/api/trips/x')).rejects.toThrow('Trip not found');
  });

  it('refuses a sign-in answer that carries no session', async () => {
    await expect(client(async () => new Response('{"ok":true}', { status: 200 })).login('a@b.co', 'pw')).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('encodes query values, so a search for “B&B #1” stays one parameter', async () => {
    const urls: string[] = [];
    const api = client(async (u) => {
      urls.push(u);
      return new Response('{"results":[]}');
    });
    await api.request('/api/search', { query: { q: 'B&B #1', lon: 153, lat: undefined, limit: 6 } });
    expect(urls[0]).toBe('https://maps.test/api/search?q=B%26B%20%231&lon=153&limit=6');
  });

  it('keeps sessions in step with the screens even if the phone’s secure storage fails', async () => {
    const seen: unknown[] = [];
    const api = createApiClient({
      baseUrl: async () => 'https://maps.test',
      fetch: (async () => new Response('{}')) as unknown as typeof fetch,
      tokens: {
        getRefreshToken: async () => 'R',
        setRefreshToken: async () => {
          throw new Error('keystore unavailable');
        },
      },
      onSession: (a) => seen.push(a),
    });
    await api.logout().catch(() => undefined);
    expect(seen).toEqual([null]);
  });
});

describe('answers checked against the shared contract', () => {
  const api = (body: unknown) =>
    createApiClient({
      baseUrl: async () => 'https://maps.test',
      fetch: (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch,
      tokens: { getRefreshToken: async () => null, setRefreshToken: async () => undefined },
    });
  const stats = { roadKm: 1.5, roadsTravelled: 3, newRoadsWeek: 1, newRoadsMonth: 2, byMode: { carKm: 1, footKm: 0.5 }, firstVisitAt: null, tripCount: 1, distanceKm: 4 };

  it('passes a matching answer through, without fields the app doesn’t know', async () => {
    await expect(api({ ...stats, somethingNew: true }).request('api/coverage/stats', { schema: CoverageStatsSchema })).resolves.toEqual(stats);
  });

  it('says the app and server are out of step when a server from before coverage-by-roads answers', async () => {
    const old = { cellsVisited: 0, areaKm2: 0, newCellsWeek: 0, newCellsMonth: 0, byMode: { car: 0, foot: 0 }, firstVisitAt: null, tripCount: 0, distanceKm: 0 };
    await expect(api(old).request('api/coverage/stats', { schema: CoverageStatsSchema })).rejects.toMatchObject({
      code: 'unexpected_response',
      message: expect.stringMatching(/needs updating/),
    });
  });
});

describe('server address', () => {
  it('accepts an address as people type it', () => {
    expect(normaliseServerUrl('maps.example.com')).toBe('https://maps.example.com');
    expect(normaliseServerUrl('  Maps.Example.com/ ')).toBe('https://maps.example.com');
    // Keyboards like to add a space after a full stop.
    expect(normaliseServerUrl('maps. example.com')).toBe('https://maps.example.com');
    expect(normaliseServerUrl('https://maps.example.com//')).toBe('https://maps.example.com');
    expect(normaliseServerUrl('http://10.0.2.2:3000')).toBe('http://10.0.2.2:3000');
    expect(normaliseServerUrl('https://example.com/wayfinder/')).toBe('https://example.com/wayfinder');
    expect(normaliseServerUrl('HTTPS://maps.example.com')).toBe('https://maps.example.com');
  });

  it('refuses what can’t be a server', () => {
    for (const bad of ['', '   ', 'https://', 'ftp://maps.example.com', 'https://maps.example.com?x=1', 'https://user@maps.example.com', 'https://.com', 'maps..com']) {
      expect(normaliseServerUrl(bad)).toBeNull();
    }
    expect(isServerUrl('https://maps.example.com')).toBe(true);
    expect(isServerUrl('https://')).toBe(false);
    expect(isServerUrl('maps.example.com')).toBe(false);
  });
});
