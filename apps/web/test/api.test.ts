import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage, onAuthChange, refreshSession, setSession } from '../src/lib/api';
import { apiError, fakeApi, reply } from './fakeApi';
import { auth, user } from './fixtures';

afterEach(() => setSession(null));

describe('api()', () => {
  it('sends JSON with the access token, and drops empty query values', async () => {
    const server = fakeApi({ 'POST /api/things': (req) => ({ echoed: req.body }) });
    setSession(auth());
    const out = await api<{ echoed: unknown }>('/api/things', { method: 'POST', body: { a: 1 }, query: { q: 'x', empty: '', none: null, skip: undefined, n: 0 } });
    expect(out).toEqual({ echoed: { a: 1 } });
    const [req] = server.calls('POST /api/things');
    expect(req!.headers.get('authorization')).toBe('Bearer access-token');
    expect(req!.headers.get('content-type')).toBe('application/json');
    expect([...req!.query.keys()]).toEqual(['q', 'n']);
  });

  it('returns undefined for 204 and the raw Response when asked', async () => {
    fakeApi({ 'DELETE /api/x': () => reply(204), 'GET /api/file': () => new Response('hello') });
    await expect(api('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
    const res = await api<Response>('/api/file', { raw: true });
    await expect(res.text()).resolves.toBe('hello');
  });

  it('renews an expired access token once and retries', async () => {
    let first = true;
    const server = fakeApi({
      'GET /api/me': () => {
        if (first) {
          first = false;
          return apiError(401, 'unauthorized', 'Expired');
        }
        return user();
      },
      'POST /api/auth/refresh': () => auth(user({ email: 'renewed@example.test' })),
    });
    const seen = vi.fn();
    const off = onAuthChange(seen);
    await expect(api('/api/me')).resolves.toMatchObject({ id: 'u-1' });
    off();
    expect(server.calls('GET /api/me')).toHaveLength(2);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ email: 'renewed@example.test' }) }));
  });

  it('does not try to renew on auth endpoints, and signs out when renewal fails', async () => {
    const server = fakeApi({
      'POST /api/auth/login': () => apiError(401, 'invalid_credentials', 'Wrong email or password'),
      'GET /api/me': () => apiError(401, 'unauthorized', 'Expired'),
      'POST /api/auth/refresh': () => apiError(401, 'unauthorized', 'No session'),
    });
    await expect(api('/api/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials', message: 'Wrong email or password' });
    expect(server.calls('POST /api/auth/refresh')).toHaveLength(0);
    const seen = vi.fn();
    onAuthChange(seen);
    await expect(api('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(seen).toHaveBeenLastCalledWith(null);
  });

  it('shares one refresh between concurrent callers', async () => {
    const server = fakeApi({ 'POST /api/auth/refresh': () => auth() });
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toEqual(b);
    expect(server.calls('POST /api/auth/refresh')).toHaveLength(1);
  });

  it('returns null from refresh when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(refreshSession()).resolves.toBeNull();
  });

  it('turns failures into readable messages', async () => {
    fakeApi({
      'GET /api/500': () => new Response('<html>', { status: 502 }),
      'GET /api/429': () => reply(429, 'not json'),
      'GET /api/404': () => new Response('', { status: 404 }),
      'GET /api/422': () => apiError(422, 'validation', 'Check the form', [{ path: 'email', message: 'Invalid email' }]),
    });
    await expect(api('/api/500')).rejects.toMatchObject({ status: 502, message: 'The server had a problem. Please try again.' });
    await expect(api('/api/429')).rejects.toMatchObject({ status: 429, message: 'Too many requests. Wait a moment and try again.' });
    await expect(api('/api/404')).rejects.toMatchObject({ code: 'error', message: 'Request failed (404)' });
    await expect(api('/api/422')).rejects.toMatchObject({ details: [{ path: 'email', message: 'Invalid email' }] });
  });
});

describe('errorMessage', () => {
  it('reads ApiErrors, Errors and anything else', () => {
    expect(errorMessage(new ApiError(400, 'bad', 'Nope'))).toBe('Nope');
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
    expect(errorMessage('huh')).toBe('Something went wrong');
  });
});
