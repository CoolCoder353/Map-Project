/**
 * A stand-in for the server. Tests declare the endpoints a screen should call; anything else
 * fails the test, so a screen can't quietly start calling something new.
 *
 *   const api = fakeApi({ 'GET /api/trips': () => ({ items: [], nextCursor: null }) });
 *   ...
 *   expect(api.calls('POST /api/feedback')[0].body).toMatchObject({ type: 'bug' });
 */
import { vi } from 'vitest';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

/** Return this from a handler to answer with a status other than 200. */
export class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}
export const reply = (status: number, body?: unknown) => new Reply(status, body);
export const apiError = (status: number, code: string, message: string, details?: unknown) =>
  reply(status, { error: { code, message, ...(details !== undefined ? { details } : {}) } });

export type Handler = (req: FakeRequest) => unknown;
export type Routes = Record<string, Handler>;

let installed: FakeApi | null = null;

export interface FakeApi {
  /** Requests made to "METHOD /path", oldest first. */
  calls(key: string): FakeRequest[];
  /** Add or replace endpoints mid-test. */
  on(routes: Routes): void;
  /** Requests nothing answered. */
  unhandled: string[];
}

export function fakeApi(routes: Routes = {}): FakeApi {
  const table: Routes = { ...routes };
  const log: Array<{ key: string; req: FakeRequest }> = [];
  const unhandled: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'http://localhost');
      const method = (init.method ?? 'GET').toUpperCase();
      const key = `${method} ${url.pathname}`;
      if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const req: FakeRequest = {
        method,
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
        headers: new Headers(init.headers),
      };
      log.push({ key, req });
      const handler = table[key] ?? matchPattern(table, method, url.pathname);
      if (!handler) {
        unhandled.push(key);
        return json(599, { error: { code: 'unhandled', message: `No fake for ${key}` } });
      }
      const out = await handler(req);
      if (out instanceof Response) return out;
      if (out instanceof Reply) return out.status === 204 ? new Response(null, { status: 204 }) : json(out.status, out.body ?? {});
      return out === undefined ? new Response(null, { status: 204 }) : json(200, out);
    }),
  );
  installed = {
    calls: (key) => log.filter((l) => l.key === key || matches(key, l.key)).map((l) => l.req),
    on: (more) => Object.assign(table, more),
    unhandled,
  };
  return installed;
}

/** Keys may use ":param" segments: "GET /api/trips/:id". */
function matchPattern(table: Routes, method: string, path: string): Handler | undefined {
  for (const [key, h] of Object.entries(table)) if (matches(key, `${method} ${path}`)) return h;
  return undefined;
}

function matches(pattern: string, key: string): boolean {
  if (!pattern.includes(':')) return false;
  const [pm, pp] = pattern.split(' ') as [string, string];
  const [km, kp] = key.split(' ') as [string, string];
  if (pm !== km) return false;
  const a = pp.split('/');
  const b = kp.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function resetFakeApi() {
  if (installed && installed.unhandled.length) {
    const list = installed.unhandled.join(', ');
    installed = null;
    vi.unstubAllGlobals();
    throw new Error(`The screen called endpoints the test didn't expect: ${list}`);
  }
  installed = null;
  vi.unstubAllGlobals();
}
