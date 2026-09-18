/**
 * End-to-end smoke test of a running deployment: health, map style, vector tiles, search,
 * reverse geocoding, fastest/explore/round-trip routing and discover, using the real
 * GraphHopper graph and PMTiles built by the data pipeline.
 *
 *   API_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm verify:stack
 */
import type { AuthResponse, DiscoverItem, ExploreRouteResponse, Place, Route, RoundTripResponse } from '@wayfinder/shared';

const base = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');

let failures = 0;
async function check(name: string, fn: () => Promise<string>) {
  const start = performance.now();
  try {
    const detail = await fn();
    console.log(`  ok   ${name} — ${detail} (${Math.round(performance.now() - start)} ms)`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name} — ${(err as Error).message}`);
  }
}

const auth = (await (
  await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client': 'mobile' },
    body: JSON.stringify({ email, password }),
  })
).json()) as AuthResponse;
if (!auth.accessToken) throw new Error('Could not sign in');
const headers = { 'content-type': 'application/json', authorization: `Bearer ${auth.accessToken}` };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// Canberra: a street address, a lookout and a homestead ~25 km south.
const braddon: [number, number] = [149.135, -35.271];
const lanyon: [number, number] = [149.0848, -35.4917];

console.log(`Verifying ${base}`);

await check('health', async () => {
  const h = (await api<{ status: string; database: boolean; routing: boolean }>('/api/health'));
  if (!h.database || !h.routing) throw new Error(`database=${h.database} routing=${h.routing}`);
  return h.status;
});

await check('public config', async () => {
  const c = await api<{ appName: string; voice: string; osmDataDate: string | null }>('/api/config');
  if (!c.osmDataDate) throw new Error('no OSM data date recorded — has the refresh run?');
  return `${c.appName}, voice ${c.voice}, data ${c.osmDataDate}`;
});

await check('map style', async () => {
  const style = await api<{ layers: unknown[]; sources: Record<string, { url: string }> }>('/map/style.json');
  return `${style.layers.length} layers, source ${Object.keys(style.sources)[0]}`;
});

await check('tilejson', async () => {
  const tj = await api<{ minzoom: number; maxzoom: number; bounds: number[]; vector_layers: unknown[] }>('/tiles/tiles.json');
  return `z${tj.minzoom}–${tj.maxzoom}, ${(tj.vector_layers as unknown[]).length} layers, bounds ${tj.bounds.map((n) => n.toFixed(1)).join(',')}`;
});

await check('vector tile over Canberra', async () => {
  // z12 tile containing Braddon.
  const z = 12;
  const x = Math.floor(((braddon[0] + 180) / 360) * 2 ** z);
  const latRad = (braddon[1] * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z);
  const res = await fetch(`${base}/tiles/${z}/${x}/${y}.mvt`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = (await res.arrayBuffer()).byteLength;
  if (bytes < 1000) throw new Error(`tile is only ${bytes} bytes`);
  return `${(bytes / 1024).toFixed(0)} KB, encoding ${res.headers.get('content-encoding') ?? 'none'}`;
});

await check('font glyphs', async () => {
  const res = await fetch(`${base}/map/assets/fonts/Noto%20Sans%20Regular/0-255.pbf`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `${((await res.arrayBuffer()).byteLength / 1024).toFixed(0)} KB`;
});

await check('search (suburb)', async () => {
  const r = await api<{ results: Place[] }>(`/api/search?q=Braddon&lon=${braddon[0]}&lat=${braddon[1]}`);
  if (!r.results.some((p) => p.name.toLowerCase().includes('braddon'))) throw new Error(`no Braddon in ${r.results.map((p) => p.name).join(', ')}`);
  return `${r.results.length} results, first "${r.results[0]!.name}" (${r.results[0]!.kind})`;
});

await check('search (fuzzy POI)', async () => {
  const r = await api<{ results: Place[] }>(`/api/search?q=mount ainsli&lon=${braddon[0]}&lat=${braddon[1]}`);
  if (r.results.length === 0) throw new Error('no results');
  return `first "${r.results[0]!.name}"`;
});

const km = (m: number | undefined) => (m === undefined ? '?' : `${(m / 1000).toFixed(1)} km`);

await check('search (nearest branch of a chain)', async () => {
  const r = await api<{ results: Place[] }>(`/api/search?q=Woolworths&lon=${braddon[0]}&lat=${braddon[1]}`);
  const first = r.results[0];
  if (!first || (first.distanceM ?? Infinity) > 5000) throw new Error(`first is ${first?.name} at ${km(first?.distanceM)}`);
  if (!/ACT 26\d\d/.test(first.context ?? '')) throw new Error(`context "${first.context ?? ''}"`);
  return `${first.name} · ${first.context} · ${km(first.distanceM)}`;
});

await check('search (category word)', async () => {
  const r = await api<{ results: Place[] }>(`/api/search?q=petrol&lon=${braddon[0]}&lat=${braddon[1]}`);
  const fuel = r.results.filter((p) => p.typeLabel === 'Fuel');
  if (fuel.length === 0 || (fuel[0]!.distanceM ?? Infinity) > 10_000) throw new Error(`no fuel nearby: ${r.results.map((p) => p.name).join(', ')}`);
  return `${fuel.length} fuel stations, nearest ${fuel[0]!.name} at ${km(fuel[0]!.distanceM)}`;
});

await check('search (same street name, nearest suburb first)', async () => {
  const q = [149.232, -35.354];
  const r = await api<{ results: Place[] }>(`/api/search?q=Main%20Street&lon=${q[0]}&lat=${q[1]}`);
  if (!r.results[0]?.context?.startsWith('Queanbeyan')) throw new Error(`first context "${r.results[0]?.context ?? ''}"`);
  return r.results.slice(0, 3).map((p) => p.context).join(' | ');
});

await check('search (opening hours)', async () => {
  const withHours: Place[] = [];
  for (const q of ['Woolworths', 'Coles', 'Aldi', 'Bunnings']) {
    const r = await api<{ results: Place[] }>(`/api/search?q=${q}&lon=${braddon[0]}&lat=${braddon[1]}`);
    withHours.push(...r.results.filter((p) => p.hours));
  }
  if (withHours.length === 0) throw new Error('no nearby store has parseable hours');
  return `${withHours[0]!.name}: ${withHours[0]!.hours!.label}`;
});

await check('reverse geocode', async () => {
  const r = await api<{ place: Place | null }>(`/api/reverse?lon=${braddon[0]}&lat=${braddon[1]}`);
  if (!r.place) throw new Error('nothing found');
  return `${r.place.name} (${r.place.kind})`;
});

let fastest: Route | undefined;
await check('fastest route (car)', async () => {
  fastest = await api<Route>('/api/routes/fastest', { method: 'POST', body: JSON.stringify({ from: braddon, to: lanyon, mode: 'car' }) });
  if (fastest.geometry.length < 50) throw new Error(`only ${fastest.geometry.length} geometry points`);
  return `${(fastest.distanceM / 1000).toFixed(1)} km, ${Math.round(fastest.durationS / 60)} min, ${fastest.instructions.length} steps`;
});

await check('explore routes (car, +20 min)', async () => {
  const r = await api<ExploreRouteResponse>('/api/routes/explore', { method: 'POST', body: JSON.stringify({ from: braddon, to: lanyon, mode: 'car', budgetMin: 20 }) });
  const extra = r.explore.map((e) => `+${Math.round(e.extraDurationS / 60)} min/${e.novelty.newKm.toFixed(1)} km new`);
  if (r.explore.some((e) => e.durationS > r.fastest.durationS + 20 * 60 + 1)) throw new Error('a route exceeded the time budget');
  return `fastest ${Math.round(r.fastest.durationS / 60)} min; ${r.explore.length} explore [${extra.join(', ')}]`;
});

await check('walking route', async () => {
  const r = await api<Route>('/api/routes/fastest', { method: 'POST', body: JSON.stringify({ from: braddon, to: [149.1486, -35.2809], mode: 'foot' }) });
  return `${(r.distanceM / 1000).toFixed(1)} km, ${Math.round(r.durationS / 60)} min`;
});

await check('round trip (foot, 60 min)', async () => {
  const r = await api<RoundTripResponse>('/api/routes/roundtrip', { method: 'POST', body: JSON.stringify({ start: braddon, mode: 'foot', targetMin: 60 }) });
  if (r.routes.length === 0) throw new Error('no loops generated');
  return r.routes.map((x) => `${Math.round(x.durationS / 60)} min/${(x.distanceM / 1000).toFixed(1)} km`).join(', ');
});

await check('discover', async () => {
  const r = await api<{ items: DiscoverItem[] }>(`/api/discover?lon=${braddon[0]}&lat=${braddon[1]}&mode=car&maxMinutes=45&limit=5`);
  if (r.items.length === 0) throw new Error('no suggestions');
  return r.items.map((i) => `${i.name} (${i.category})`).join(', ');
});

await check('places imported', async () => {
  const r = await api<{ results: Place[] }>('/api/search?q=Sydney');
  return `search works; e.g. ${r.results.slice(0, 2).map((p) => `${p.name} [${p.kind}]`).join(', ')}`;
});

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
