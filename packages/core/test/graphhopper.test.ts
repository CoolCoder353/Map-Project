import { describe, expect, it } from 'vitest';
import { GraphHopperClient } from '../src/lib/graphhopper.js';
import { AppError } from '../src/lib/errors.js';

const ghFailing = (status: number, message: string) =>
  new GraphHopperClient('http://gh', (async () => new Response(JSON.stringify({ message }), { status })) as typeof fetch);

async function failure(client: GraphHopperClient, points = 2) {
  const pts = Array.from({ length: points }, (_, i) => [151 + i / 100, -33.8] as [number, number]);
  return client.route({ points: pts, profile: 'car' }).then(
    () => expect.fail('expected an error'),
    (e: unknown) => e as AppError,
  );
}

describe('GraphHopper errors shown to people', () => {
  it('names the start, a stop or the destination when a point is off the road network', async () => {
    expect((await failure(ghFailing(400, 'Cannot find point 0: -33.788,151.4217'))).message).toBe(
      'There is no road or path near your start. Try moving it closer to one.',
    );
    expect((await failure(ghFailing(400, 'Cannot find point 1: -33.788,151.4217'))).message).toBe(
      'There is no road or path near your destination. Try moving it closer to one.',
    );
    expect((await failure(ghFailing(400, 'Cannot find point 1: -33.788,151.4217'), 3)).message).toBe(
      'There is no road or path near one of your stops. Try moving it closer to one.',
    );
  });

  it('explains unconnected places and keeps the 422 no_route code', async () => {
    const e = await failure(ghFailing(400, 'Connection between locations not found'));
    expect(e).toMatchObject({ statusCode: 422, code: 'no_route' });
    expect(e.message).toBe('These places are not connected by roads or paths for this mode of travel.');
  });

  it('never leaks raw coordinates for other 400s', async () => {
    const e = await failure(ghFailing(400, 'Point 0 -33.1,151.2 is out of bounds'));
    expect(e.message).toBe('No route could be found between these places.');
  });
});

type Call = { url: string; init: RequestInit };
function recording(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const client = new GraphHopperClient('http://gh', (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch);
  return { client, calls, body: (i = 0) => JSON.parse(String(calls[i]!.init.body)) as Record<string, unknown> };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const path = { distance: 1000, time: 60_000, points: { type: 'LineString', coordinates: [[153, -27], [153.01, -27]] }, instructions: [] };

describe('GraphHopper requests', () => {
  it('asks for a plain fastest route with way ids and speed limits, using the fast (CH) graph', async () => {
    const gh = recording(() => json({ paths: [path] }));
    expect(await gh.client.route({ points: [[153, -27], [153.1, -27.1]], profile: 'car' })).toEqual([path]);
    expect(gh.calls[0]!.url).toBe('http://gh/route');
    expect(gh.body()).toEqual({ points: [[153, -27], [153.1, -27.1]], profile: 'car', points_encoded: false, instructions: true, calc_points: true, locale: 'en', details: ['osm_way_id', 'max_speed'] });
  });

  it('turns off CH for custom models, alternatives and pass-through vias', async () => {
    const gh = recording(() => json({ paths: [path] }));
    await gh.client.route({ points: [[153, -27], [153.1, -27.1]], profile: 'car', customModel: { priority: [{ if: 'road_class == TRACK', multiply_by: 0.2 }] }, alternatives: 3 });
    expect(gh.body()).toMatchObject({ 'ch.disable': true, custom_model: { priority: [{ if: 'road_class == TRACK', multiply_by: 0.2 }] }, algorithm: 'alternative_route', 'alternative_route.max_paths': 3 });
    await gh.client.route({ points: [[153, -27], [153.05, -27.05], [153.1, -27.1]], profile: 'car', passThrough: true, alternatives: 3 });
    expect(gh.body(1)).toMatchObject({ 'ch.disable': true, pass_through: true });
    // Alternatives only exist between two points.
    expect(gh.body(1).algorithm).toBeUndefined();
    await gh.client.route({ points: [[153, -27], [153.1, -27.1]], profile: 'foot', passThrough: true });
    expect(gh.body(2)).not.toHaveProperty('pass_through');
    expect(gh.body(2)).not.toHaveProperty('ch.disable');
  });

  it('reports an unreachable or failing engine as unavailable (503)', async () => {
    const down = new GraphHopperClient('http://gh', (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(down.route({ points: [[153, -27], [153.1, -27.1]], profile: 'car' })).rejects.toMatchObject({ statusCode: 503, message: 'Routing engine unreachable: fetch failed' });
    const broken = recording(() => new Response('<html>oops</html>', { status: 500 }));
    await expect(broken.client.route({ points: [[153, -27], [153.1, -27.1]], profile: 'car' })).rejects.toMatchObject({ statusCode: 503, message: 'GraphHopper error 500' });
  });

  it('snaps a track with GPX, times included, and asks for way ids', async () => {
    const gh = recording(() => json({ paths: [path] }));
    expect(await gh.client.match([{ lon: 153, lat: -27, ts: Date.parse('2026-09-20T00:00:00Z') }, { lon: 153.01, lat: -27 }], 'foot')).toEqual(path);
    expect(gh.calls[0]!.url).toBe('http://gh/match?profile=foot&points_encoded=false&details=osm_way_id');
    const gpx = String(gh.calls[0]!.init.body);
    expect(gpx).toContain('<trkpt lat="-27" lon="153"><time>2026-09-20T00:00:00.000Z</time></trkpt><trkpt lat="-27" lon="153.01"></trkpt>');
    expect((gh.calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/gpx+xml');
  });

  it('gives up on matching quietly: too few points, a refusal, no path, or no engine', async () => {
    const refuse = recording(() => json({ message: 'Sequence is broken' }, 400));
    expect(await refuse.client.match([{ lon: 153, lat: -27 }], 'car')).toBeNull();
    expect(refuse.calls).toHaveLength(0);
    expect(await refuse.client.match([{ lon: 153, lat: -27 }, { lon: 153.1, lat: -27 }], 'car')).toBeNull();
    const empty = recording(() => json({ paths: [] }));
    expect(await empty.client.match([{ lon: 153, lat: -27 }, { lon: 153.1, lat: -27 }], 'car')).toBeNull();
    const down = new GraphHopperClient('http://gh', (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch);
    expect(await down.match([{ lon: 153, lat: -27 }, { lon: 153.1, lat: -27 }], 'car')).toBeNull();
  });

  it('reads isochrones as outer rings of polygons and multipolygons', async () => {
    const ring = [[153, -27], [153.1, -27], [153.1, -27.1], [153, -27]];
    const gh = recording(() =>
      json({
        polygons: [
          { geometry: { type: 'Polygon', coordinates: [ring, [[0, 0]]] } },
          { geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring.map(([x, y]) => [x! + 1, y!])]] } },
          { geometry: { type: 'Point', coordinates: [1, 2] } },
        ],
      }),
    );
    const rings = await gh.client.isochrone([153.02, -27.47], 'car', 1799.6);
    expect(rings).toHaveLength(3);
    expect(rings[0]).toEqual(ring);
    expect(Object.fromEntries(new URL(gh.calls[0]!.url).searchParams)).toEqual({ point: '-27.47,153.02', profile: 'car', time_limit: '1800', buckets: '1' });
  });

  it('checks health and the data date', async () => {
    const ok = recording((url) => (url.endsWith('/info') ? json({ data_date: '2026-09-16T00:00:00Z' }) : new Response('OK')));
    expect(await ok.client.health()).toMatchObject({ up: true, detail: null, latencyMs: expect.any(Number) });
    expect(await ok.client.dataDate()).toBe('2026-09-16T00:00:00Z');
    const starting = recording((url) => (url.endsWith('/info') ? json({}) : new Response('', { status: 503 })));
    expect(await starting.client.health()).toMatchObject({ up: false, detail: 'HTTP 503' });
    expect(await starting.client.dataDate()).toBeNull();
    const down = new GraphHopperClient('http://gh', (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch);
    expect(await down.health()).toEqual({ up: false, latencyMs: null, detail: 'ECONNREFUSED' });
    expect(await down.dataDate()).toBeNull();
  });
});
