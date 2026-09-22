/**
 * DEV/E2E ONLY: a stand-in for GraphHopper that answers /route, /match, /isochrone, /health and
 * /info with straight-line geometry, so the UI and end-to-end tests run without the routing graph.
 *   pnpm dev:fake-gh   → http://127.0.0.1:8989
 */
import { createServer } from 'node:http';
import { type LngLat, bearingDeg, destination, haversineM } from '@wayfinder/shared';

const SPEED = { car: 13.9, foot: 1.35 } as Record<string, number>;

function path(points: LngLat[], profile: string, wobble = 0) {
  const coords: LngLat[] = [];
  const instructions: unknown[] = [];
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = haversineM(a, b) * 1.25;
    const n = Math.max(2, Math.ceil(len / 80));
    const startIdx = coords.length === 0 ? 0 : coords.length - 1;
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const p = destination(a, bearingDeg(a, b), haversineM(a, b) * t);
      const side = Math.sin(t * Math.PI) * haversineM(a, b) * (0.08 + wobble);
      coords.push(destination(p, (bearingDeg(a, b) + 90) % 360, side));
    }
    distance += len;
    instructions.push({
      distance: len,
      sign: i === 1 ? 0 : 2,
      interval: [startIdx, coords.length - 1],
      text: i === 1 ? 'Continue onto Demo Road' : 'Turn right onto Sample Street',
      street_name: i === 1 ? 'Demo Road' : 'Sample Street',
      time: (len / (SPEED[profile] ?? 10)) * 1000,
    });
    if (i < points.length - 1) instructions.push({ distance: 0, sign: 5, interval: [coords.length - 1, coords.length - 1], text: 'Waypoint', time: 0 });
  }
  instructions.push({ distance: 0, sign: 4, interval: [coords.length - 1, coords.length - 1], text: 'Arrive at destination', time: 0 });
  return { distance, time: (distance / (SPEED[profile] ?? 10)) * 1000, points: { type: 'LineString', coordinates: coords }, instructions };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') return send(200, { status: 'ok' });
  if (url.pathname === '/info') return send(200, { data_date: '2026-09-01T00:00:00Z', fake: true });
  if (url.pathname === '/isochrone') {
    const [lat, lon] = (url.searchParams.get('point') ?? '0,0').split(',').map(Number);
    const profile = url.searchParams.get('profile') ?? 'car';
    const r = Number(url.searchParams.get('time_limit') ?? 600) * (SPEED[profile] ?? 10) * 0.7;
    const ring = Array.from({ length: 25 }, (_, i) => destination([lon!, lat!], (i * 15) % 360, r * (0.85 + 0.15 * Math.sin(i))));
    ring.push(ring[0]!);
    return send(200, { polygons: [{ type: 'Feature', properties: { bucket: 0 }, geometry: { type: 'Polygon', coordinates: [ring] } }] });
  }
  if (url.pathname === '/route' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as { points: LngLat[]; profile: string; custom_model?: unknown; algorithm?: string };
      const paths = [path(body.points, body.profile, body.custom_model ? 0.05 : 0)];
      if (body.algorithm === 'alternative_route') paths.push(path(body.points, body.profile, 0.2));
      send(200, { paths });
    });
    return;
  }
  if (url.pathname === '/match' && req.method === 'POST') {
    // Map matching: keep the track as it is and pretend it ran along a couple of roads, so
    // coverage (which counts roads travelled) has something to show.
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const coordinates = [...raw.matchAll(/lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"/g)].map(([, lat, lon]) => [Number(lon), Number(lat)] as LngLat);
      if (coordinates.length < 2) return send(400, { message: 'Sequence is broken' });
      let distance = 0;
      for (let i = 1; i < coordinates.length; i++) distance += haversineM(coordinates[i - 1]!, coordinates[i]!);
      const mid = Math.floor(coordinates.length / 2);
      // Two made-up ways per track, keyed off the start so different trips differ.
      const base = Math.round(Math.abs(coordinates[0]![0] * 1000) + Math.abs(coordinates[0]![1] * 1000)) * 10;
      send(200, {
        paths: [
          {
            distance,
            time: (distance / SPEED.car!) * 1000,
            points: { type: 'LineString', coordinates },
            instructions: [],
            details: { osm_way_id: [[0, mid, base + 1], [mid, coordinates.length - 1, base + 2]] },
          },
        ],
      });
    });
    return;
  }
  send(404, { message: 'not found' });
});
server.listen(Number(process.env.PORT ?? 8989), '127.0.0.1', () => console.log('Fake GraphHopper on http://127.0.0.1:8989 (dev only)'));
