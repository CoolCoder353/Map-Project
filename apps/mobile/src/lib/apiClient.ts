import type { AuthResponse, ErrorResponse } from '@wayfinder/shared/schemas';

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

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  let accessToken: string | null = null;
  let refreshing: Promise<AuthResponse | null> | null = null;

  const url = async (path: string, query?: RequestOptions['query']) => {
    const base = await opts.baseUrl();
    // Without a server there is nothing to resolve a path against, which would otherwise throw
    // an unreadable "Invalid URL" from deep inside a screen.
    if (!/^https?:\/\//i.test(base)) throw new ApiError(0, 'no_server', 'No server address set. Sign out and enter the address of your group’s server.');
    const u = new URL(path, `${base}/`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  };

  const toError = async (res: Response) => {
    let body: Partial<ErrorResponse> = {};
    try {
      body = (await res.json()) as ErrorResponse;
    } catch {
      // not JSON
    }
    const fallback = res.status >= 500 ? 'The server had a problem. Try again shortly.' : `Request failed (${res.status})`;
    return new ApiError(res.status, body.error?.code ?? 'error', body.error?.message ?? fallback, body.error?.details);
  };

  const session = async (auth: AuthResponse | null) => {
    accessToken = auth?.accessToken ?? null;
    await opts.tokens.setRefreshToken(auth?.refreshToken ?? null);
    opts.onSession?.(auth);
  };

  const raw = async (path: string, init: RequestOptions, withAuth: boolean) => {
    const target = await url(path, init.query);
    try {
      return await doFetch(target, {
        method: init.method ?? 'GET',
        headers: {
          'x-client': 'mobile',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(withAuth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      });
    } catch (err) {
      // A cancelled request is not a failure to reach the server.
      if ((err as Error).name === 'AbortError') throw err;
      // Name the server: the usual cause is that the app is pointed at the wrong one.
      throw new ApiError(0, 'offline', `Can’t reach ${new URL(target).host}. Check the server address and your connection.`);
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
        const auth = (await res.json()) as AuthResponse;
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

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const clean = path.replace(/^\//, '');
    let res = await raw(clean, init, true);
    if (res.status === 401 && !clean.startsWith('api/auth/')) {
      if (await refresh()) res = await raw(clean, init, true);
    }
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    request,
    refresh,
    get hasAccessToken() {
      return accessToken !== null;
    },
    async login(email: string, password: string) {
      const auth = await request<AuthResponse>('api/auth/login', { method: 'POST', body: { email, password } });
      await session(auth);
      return auth;
    },
    async register(inviteCode: string, email: string, password: string) {
      const auth = await request<AuthResponse>('api/auth/register', { method: 'POST', body: { inviteCode, email, password } });
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
