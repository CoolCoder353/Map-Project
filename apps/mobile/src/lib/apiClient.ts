import type { AuthResponse, ErrorResponse } from '@wayfinder/shared/schemas';
import type { ZodType } from 'zod';

/** Platform-free API client (tokens and fetch injected) so it can be unit tested. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: () => Promise<string>;
  tokens: TokenStore;
  fetch?: typeof fetch;
  onSession?: (auth: AuthResponse | null) => void;
}

export interface RequestOptions<T = unknown> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** Give up after this long; Android's HTTP client otherwise waits forever on a dead connection. */
  timeoutMs?: number;
  /**
   * The shared schema the answer must match. An APK and the server are updated separately, so
   * a server a version ahead or behind can leave out a field a screen reads; checking here turns
   * that into a plain message rather than a crash deep in the screen.
   */
  schema?: ZodType<T>;
}

const VERSION_MISMATCH =
  'The server sent something this version of the app doesn’t understand, so the app or the server needs updating. Tell whoever runs your group’s server.';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The server address as typed, made usable: "maps.example.com/" becomes
 * "https://maps.example.com". Null when it can't be a server address.
 */
export function normaliseServerUrl(input: string): string | null {
  let s = input.replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  const m = /^(https?):\/\/([^/?#@]+)(\/[^?#]*)?$/i.exec(s);
  if (!m) return null;
  const [, scheme, host, path = ''] = m;
  if (!/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(host!)) return null;
  return `${scheme!.toLowerCase()}://${host!.toLowerCase()}${path.replace(/\/+$/, '')}`;
}

/** Whether a stored address can be used to reach a server (it has a scheme and a host). */
export const isServerUrl = (u: string) => normaliseServerUrl(u) === u;

const hostOf = (u: string) => /^https?:\/\/([^/?#]+)/i.exec(u)?.[1] ?? u;

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  let accessToken: string | null = null;
  let refreshing: Promise<AuthResponse | null> | null = null;

  const url = async (path: string, query?: RequestOptions['query']) => {
    const base = await opts.baseUrl();
    // Without a server there is nothing to resolve a path against, which would otherwise throw
    // an unreadable "Invalid URL" from deep inside a screen.
    if (!isServerUrl(base)) throw new ApiError(0, 'no_server', 'No server address set. Sign out and enter the address of your group’s server.');
    // Built by hand: React Native's URL class is a partial polyfill that differs from the web's.
    const params = Object.entries(query ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return `${base}/${path}${params.length ? `?${params.join('&')}` : ''}`;
  };

  const toError = async (res: Response) => {
    let body: Partial<ErrorResponse> = {};
    try {
      body = (await res.json()) as ErrorResponse;
    } catch {
      // not JSON
    }
    const fallback =
      res.status >= 500
        ? 'The server had a problem. Try again shortly.'
        : // A 404 without the API's error body means there is no API at this address at all.
          res.status === 404 && !body.error
          ? `${hostOf(res.url || '') || 'That address'} doesn’t look like your group’s server. Check the server address.`
          : `Request failed (${res.status})`;
    return new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? fallback, body.error?.details);
  };

  const session = async (auth: AuthResponse | null) => {
    accessToken = auth?.accessToken ?? null;
    try {
      await opts.tokens.setRefreshToken(auth?.refreshToken ?? null);
    } finally {
      // Screens follow the session even if the phone's secure storage failed, so signing out
      // can never leave the app stuck signed in.
      opts.onSession?.(auth);
    }
  };

  const raw = async (path: string, init: RequestOptions, withAuth: boolean) => {
    const target = await url(path, init.query);
    // Cancelled before it started (the search box moved on): don't send it at all.
    if (init.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const cancel = () => ctrl.abort();
    init.signal?.addEventListener('abort', cancel);
    try {
      return await doFetch(target, {
        method: init.method ?? 'GET',
        headers: {
          'x-client': 'mobile',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(withAuth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      if (timedOut) throw new ApiError(0, 'timeout', `${hostOf(target)} took too long to answer. Check your connection and try again.`);
      // A cancelled request is not a failure to reach the server.
      if (init.signal?.aborted || (err as Error).name === 'AbortError') throw err;
      // Name the server: the usual cause is that the app is pointed at the wrong one.
      throw new ApiError(0, 'offline', `Can’t reach ${hostOf(target)}. Check the server address and your connection.`);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', cancel);
    }
  };

  /** The body as JSON; a page that isn't JSON (a login portal, the wrong server) says so plainly. */
  const readJson = async <T>(res: Response): Promise<T> => {
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, 'bad_response', `${hostOf(res.url || '') || 'The server'} sent something the app couldn’t read. Check the server address, or sign in to the Wi-Fi network if it asks.`);
    }
  };

  async function refresh(): Promise<AuthResponse | null> {
    refreshing ??= (async () => {
      try {
        const token = await opts.tokens.getRefreshToken();
        if (!token) return null;
        const res = await raw('api/auth/refresh', { method: 'POST', body: { refreshToken: token } }, false);
        if (res.status === 401) {
          await session(null);
          return null;
        }
        if (!res.ok) return null; // offline or server error: keep the refresh token for later
        const auth = await readJson<AuthResponse>(res);
        if (!auth?.accessToken) return null;
        await session(auth);
        return auth;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** A sign-in answer without a session isn't from this app's server. */
  const signedIn = (auth: AuthResponse | undefined) => {
    if (!auth?.accessToken || !auth.user) throw new ApiError(0, 'bad_response', 'That server didn’t answer the way this app expects. Check the server address.');
    return auth;
  };

  async function request<T>(path: string, init: RequestOptions<T> = {}): Promise<T> {
    const clean = path.replace(/^\//, '');
    let res = await raw(clean, init, true);
    if (res.status === 401 && !clean.startsWith('api/auth/')) {
      if (await refresh()) res = await raw(clean, init, true);
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    const body = await readJson<T>(res);
    if (!init.schema) return body;
    const parsed = init.schema.safeParse(body);
    if (!parsed.success) throw new ApiError(res.status, 'unexpected_response', VERSION_MISMATCH, parsed.error.issues.slice(0, 5));
    return parsed.data;
  }

  return {
    request,
    refresh,
    get hasAccessToken() {
      return accessToken !== null;
    },
    async login(email: string, password: string) {
      const auth = signedIn(await request<AuthResponse>('api/auth/login', { method: 'POST', body: { email, password } }));
      await session(auth);
      return auth;
    },
    async register(inviteCode: string, email: string, password: string) {
      const auth = signedIn(await request<AuthResponse>('api/auth/register', { method: 'POST', body: { inviteCode, email, password } }));
      await session(auth);
      return auth;
    },
    async logout() {
      const token = await opts.tokens.getRefreshToken();
      await request('api/auth/logout', { method: 'POST', body: { refreshToken: token ?? undefined } }).catch(() => undefined);
      await session(null);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? (err.message.includes('Network') ? 'No connection to the server.' : err.message) : 'Something went wrong';
