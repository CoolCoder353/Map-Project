import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tilePoint } from '../../src/signal-tiles.js';
import { type TestApp, createTestApp } from '../helpers/app.js';

let ta: TestApp;
beforeAll(async () => {
  ta = await createTestApp();
  await ta.t.db.query(`INSERT INTO traffic_signals (id, lon, lat, kind) VALUES (11, 153.0251, -27.4698, 'signals'), (12, 151.2093, -33.8688, 'crossing')`);
});
afterAll(() => ta?.close());

/** The tile at zoom z holding a point. */
const tileAt = (lon: number, lat: number, z: number) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n);
  return { x, y };
};

describe('traffic light tiles', () => {
  it('serves the lights in a tile, without signing in', async () => {
    const { x, y } = tileAt(153.0251, -27.4698, 16);
    const res = await ta.app.inject({ method: 'GET', url: `/tiles/signals/16/${x}/${y}.mvt` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.rawPayload.includes(Buffer.from('traffic_signals'))).toBe(true);
    expect(tilePoint(153.0251, -27.4698, 16, x, y).every((v) => v >= 0 && v <= 4096)).toBe(true);
  });

  it('sends nothing for empty tiles and zoomed-out ones, and refuses nonsense', async () => {
    const empty = tileAt(140, -25, 16);
    expect((await ta.app.inject({ method: 'GET', url: `/tiles/signals/16/${empty.x}/${empty.y}.mvt` })).statusCode).toBe(204);
    const far = tileAt(153.0251, -27.4698, 10);
    expect((await ta.app.inject({ method: 'GET', url: `/tiles/signals/10/${far.x}/${far.y}.mvt` })).statusCode).toBe(204);
    for (const bad of ['17/1/1', '16/-1/0', '16/x/0', '2/4/0']) {
      expect((await ta.app.inject({ method: 'GET', url: `/tiles/signals/${bad}.mvt` })).statusCode, bad).toBe(400);
    }
  });

  it('is drawn by the map style close in', async () => {
    const style = (await ta.app.inject({ method: 'GET', url: '/map/style.json', headers: { host: 'maps.test' } })).json();
    expect(style.sources.signals).toEqual({ type: 'vector', tiles: ['http://maps.test/tiles/signals/{z}/{x}/{y}.mvt'], minzoom: 14, maxzoom: 16 });
    const layers = style.layers.filter((l: { source?: string }) => l.source === 'signals');
    expect(layers.map((l: { id: string }) => l.id)).toEqual(['traffic-signals', 'traffic-signals-lamp']);
    expect(layers.every((l: { minzoom: number; 'source-layer': string }) => l.minzoom === 15 && l['source-layer'] === 'traffic_signals')).toBe(true);
  });
});
