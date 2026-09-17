import type { AuthResponse, ErrorResponse } from '@wayfinder/shared';

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

type Listener = (auth: AuthResponse | null) => void;

let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
const listeners = new Set<Listener>();

export function onAuthChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSession(auth: AuthResponse | null) {
  accessToken = auth?.accessToken ?? null;
  listeners.forEach((l) => l(auth));
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ErrorResponse> = {};
  try {
    body = (await res.json()) as ErrorResponse;
  } catch {
    // non-JSON error
  }
  const e = body.error;
  const fallback =
    res.status >= 500 ? 'The server had a problem. Please try again.' : res.status === 429 ? 'Too many requests. Wait a moment and try again.' : `Request failed (${res.status})`;
  return new ApiError(res.status, e?.code ?? 'error', e?.message ?? fallback, e?.details);
}

/** Exchange the httpOnly refresh cookie for a new access token (deduplicated). */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) {
        setSession(null);
        return null;
      }
      const auth = (await res.json()) as AuthResponse;
      setSession(auth);
      return auth;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Return the raw Response (e.g. for downloads). */
  raw?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const send = () =>
    fetch(url, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      signal: opts.signal ?? null,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
    });

  let res = await send();
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    const renewed = await refreshSession();
    if (renewed) res = await send();
  }
  if (!res.ok) throw await parseError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const errorMessage = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong';
