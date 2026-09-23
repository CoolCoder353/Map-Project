/**
 * Check a running server against what the Android app actually asks it for: every endpoint the
 * app calls, with the app's own request shapes, validated against the shared schemas.
 *
 * The app and the server ship separately, so a field the server renames is only found when the
 * two are compared. `verify:stack` proves the stack works; this proves the app can use it.
 *
 *   API_URL=https://maps.example.com EMAIL=... PASSWORD=... pnpm verify:mobile
 *
 * VERIFY_REGION picks where to test: `act` (Canberra, default) or `qld` (Brisbane).
 */
import {
  CoverageStatsSchema,
  DiscoverResponseSchema,
  ExploreRouteResponseSchema,

  PlannedRouteListSchema,
  PublicConfigSchema,
  PublicUserSchema,
  RouteSchema,
  RoundTripResponseSchema,
  SearchResponseSchema,
  TripListResponseSchema,
} from '@wayfinder/shared';
import { z } from 'zod';

const base = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
if (!email || !password) throw new Error('EMAIL and PASSWORD are required');

const REGIONS = {
  act: { at: [149.135, -35.271] as [number, number], to: [149.0848, -35.4917] as [number, number], query: 'Braddon' },
  qld: { at: [153.0251, -27.4698] as [number, number], to: [153.1094, -27.4269] as [number, number], query: 'Brisbane' },
};
const region = REGIONS[(process.env.VERIFY_REGION ?? 'act') as keyof typeof REGIONS] ?? REGIONS.act;

let failures = 0;
let accessToken = '';

/** Request exactly as apps/mobile/src/lib/apiClient.ts does, headers included. */
async function call(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}) {
  const url = new URL(path, `${base}/`);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'x-client': 'mobile',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? undefined : await res.json();
}

async function check(name: string, fn: () => Promise<string>) {
  const start = performance.now();
  try {
    console.log(`  ok   ${name} — ${await fn()} (${Math.round(performance.now() - start)} ms)`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name} — ${(err as Error).message}`);
  }
}

/** Validate with the shared schema, so a renamed or missing field fails here and not on a phone. */
function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`${what} does not match the app's schema: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
  return r.data;
}

console.log(`Mobile API contract against ${base} (${process.env.VERIFY_REGION ?? 'act'})`);

const auth = (await call('api/auth/login', { method: 'POST', body: { email, password } })) as { accessToken?: string };
if (!auth?.accessToken) throw new Error('Could not sign in');
accessToken = auth.accessToken;

await check('config, read on launch', async () => {
  const c = parse(PublicConfigSchema, await call('api/config'), 'api/config');
  return `${c.appName}, voice ${c.voice}`;
});

await check('search, as the search box sends it', async () => {
  const r = parse(SearchResponseSchema, await call('api/search', { query: { q: region.query, lon: region.at[0], lat: region.at[1], limit: 6 } }), 'api/search');
  if (r.results.length === 0) throw new Error(`no results for "${region.query}"`);
  return `${r.results.length} results, first "${r.results[0]!.name}"`;
});

await check('search by address text, as picking a contact does', async () => {
  const r = parse(SearchResponseSchema, await call('api/search', { query: { q: region.query, limit: 1 } }), 'api/search');
  return `${r.results.length} result(s)`;
});

await check('fastest route, as re-routing during navigation asks', async () => {
  const route = parse(RouteSchema, await call('api/routes/fastest', { method: 'POST', body: { from: region.at, to: region.to, mode: 'car', via: [] } }), 'api/routes/fastest');
  if (route.instructions.length === 0) throw new Error('no turn instructions, so navigation has nothing to say');
  return `${(route.distanceM / 1000).toFixed(1)} km, ${route.instructions.length} instructions`;
});

await check('explore routes, as the Plan tab asks', async () => {
  const r = parse(ExploreRouteResponseSchema, await call('api/routes/explore', { method: 'POST', body: { from: region.at, to: region.to, mode: 'car', budgetMin: 45 } }), 'api/routes/explore');
  return `fastest + ${r.explore.length} explore option(s)`;
});

await check('round trip, as the Plan tab asks', async () => {
  const r = parse(RoundTripResponseSchema, await call('api/routes/roundtrip', { method: 'POST', body: { start: region.at, mode: 'car', targetMin: 60 } }), 'api/routes/roundtrip');
  return `${r.routes.length} loop(s)`;
});

await check('discover, as the Discover tab asks', async () => {
  const r = parse(DiscoverResponseSchema, await call('api/discover', { query: { lon: region.at[0], lat: region.at[1], mode: 'car', maxMinutes: 60, limit: 25 } }), 'api/discover');
  return `${r.items.length} place(s)`;
});

await check('coverage roads, as the Coverage map asks', async () => {
  const bbox = [region.at[0] - 0.2, region.at[1] - 0.2, region.at[0] + 0.2, region.at[1] + 0.2].map((n) => n.toFixed(5)).join(',');
  const fc = parse(
    z.object({
      type: z.literal('FeatureCollection'),
      features: z.array(z.object({ type: z.literal('Feature'), geometry: z.object({ type: z.string() }), properties: z.looseObject({ recent: z.boolean().optional() }).nullable() })),
    }),
    await call('api/coverage', { query: { bbox, zoom: 12, format: 'geojson' } }),
    'api/coverage?format=geojson',
  );
  return `${fc.features.length} road line(s)`;
});

await check('coverage stats, as the Coverage tab shows', async () => {
  const s = parse(CoverageStatsSchema, await call('api/coverage/stats'), 'api/coverage/stats');
  return `${s.roadKm.toFixed(1)} km of road, ${s.tripCount} trips`;
});

await check('trips list, as the Trips tab pages through', async () => {
  const r = parse(TripListResponseSchema, await call('api/trips', { query: { limit: 30 } }), 'api/trips');
  return `${r.items.length} trip(s)`;
});

await check('planned routes sent from the website', async () => {
  const r = parse(PlannedRouteListSchema, await call('api/planned-routes'), 'api/planned-routes');
  return `${r.items.length} waiting`;
});

await check('settings, as the Settings tab saves them', async () => {
  const u = parse(PublicUserSchema, await call('api/me/settings', { method: 'PATCH', body: { defaultMode: 'car' } }), 'api/me/settings');
  return `defaultMode ${u.settings.defaultMode}`;
});

await check('uploading recorded points', async () => {
  const now = Date.now();
  const points = Array.from({ length: 5 }, (_, i) => ({ ts: now - (5 - i) * 5000, lon: region.at[0] + i * 0.0002, lat: region.at[1], accuracyM: 8 }));
  const r = parse(
    z.looseObject({ accepted: z.number().int() }),
    await call('api/tracks/batches', { method: 'POST', body: { batchId: crypto.randomUUID(), source: 'background', points } }),
    'api/tracks/batches',
  );
  return `${r.accepted} point(s) accepted`;
});

await check('sending feedback', async () => {
  const context = { screen: 'Android settings', platform: 'android', appVersion: 'contract-check', device: 'Android 15 · contract check' };
  const item = parse(z.object({ id: z.uuid() }), await call('api/feedback', { method: 'POST', body: { type: 'other', message: 'Contract check — please ignore.', context } }), 'api/feedback');
  return `accepted as ${item.id}`;
});

await check('the map style the app loads', async () => {
  const res = await fetch(`${base}/map/style.json?theme=dark`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const style = (await res.json()) as { sources: Record<string, { url?: string; tiles?: string[] }>; glyphs?: string };
  const source = Object.values(style.sources)[0] ?? {};
  const tiles = source.url ?? source.tiles?.[0] ?? '';
  // Android's native map cannot resolve a relative URL: it has no page to resolve it against.
  if (!/^https?:\/\//i.test(tiles)) throw new Error(`tile URL is relative ("${tiles}"); Android cannot load it — set PUBLIC_URL`);
  if (style.glyphs && !/^https?:\/\//i.test(style.glyphs)) throw new Error(`glyph URL is relative ("${style.glyphs}"); labels will not draw on Android`);
  return `tiles ${tiles}`;
});

console.log(failures === 0 ? '\nAll mobile contract checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
