import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reloadingTileArchive } from '../../src/plugins/tiles.js';
import { type TestApp, createTestApp } from '../helpers/app.js';

// A one-tile PMTiles v3 archive laid out the way Planetiler writes it: uncompressed
// directories, gzip-compressed tile data.
const TILE = Buffer.from('1a0a0a08626f756e64617279', 'hex'); // an MVT layer header, not gzip

function varint(n: number, out: number[]) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

function buildArchive(tile: Buffer): Buffer {
  const data = gzipSync(tile);
  const dir: number[] = [];
  for (const v of [1, 0, 1, data.length, 1]) varint(v, dir); // 1 entry: id 0, run 1, length, offset 0 (+1)
  const header = Buffer.alloc(127);
  header.write('PMTiles', 0, 'ascii');
  header.writeUInt8(3, 7);
  const u64 = (off: number, v: number) => header.writeBigUInt64LE(BigInt(v), off);
  u64(8, 127); // root directory
  u64(16, dir.length);
  u64(24, 127 + dir.length); // metadata
  u64(32, 2);
  u64(40, 0);
  u64(48, 0);
  u64(56, 127 + dir.length + 2); // tile data
  u64(64, data.length);
  u64(72, 1);
  u64(80, 1);
  u64(88, 1);
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(1, 97); // internal compression: none
  header.writeUInt8(2, 98); // tile compression: gzip
  header.writeUInt8(1, 99); // MVT
  header.writeUInt8(0, 100);
  header.writeUInt8(0, 101);
  header.writeInt32LE(-1800000000, 102);
  header.writeInt32LE(-850000000, 106);
  header.writeInt32LE(1800000000, 110);
  header.writeInt32LE(850000000, 114);
  return Buffer.concat([header, Buffer.from(dir), Buffer.from('{}'), data]);
}

let ta: TestApp;
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wf-tiles-'));
  const path = join(dir, 'test.pmtiles');
  await writeFile(path, buildArchive(TILE));
  ta = await createTestApp({ tiles: reloadingTileArchive(path) });
});
afterAll(() => ta?.close());

describe('vector tiles from a gzip-compressed archive', () => {
  it('sends bytes that match their content-encoding', async () => {
    const res = await ta.app.inject({ method: 'GET', url: '/tiles/0/0/0.mvt', headers: { 'accept-encoding': 'gzip' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
    const body = res.rawPayload;
    const decoded = res.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body;
    expect(decoded.equals(TILE)).toBe(true);
  });

  it('returns 204 outside the archive and tilejson from the header', async () => {
    expect((await ta.app.inject({ method: 'GET', url: '/tiles/1/0/0.mvt' })).statusCode).toBe(204);
    const tj = (await ta.app.inject({ method: 'GET', url: '/tiles/tiles.json' })).json();
    expect(tj).toMatchObject({ minzoom: 0, maxzoom: 0 });
  });
});
