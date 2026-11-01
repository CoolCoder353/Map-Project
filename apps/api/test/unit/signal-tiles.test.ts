import { describe, expect, it } from 'vitest';
import { SIGNAL_LAYER, encodeSignalTile, tileBounds, tilePoint } from '../../src/signal-tiles.js';

/** A small protobuf reader: each field as [number, value], value a number or the bytes. */
function fields(buf: Uint8Array): Array<[number, number | Uint8Array]> {
  const out: Array<[number, number | Uint8Array]> = [];
  let i = 0;
  const varint = () => {
    let v = 0;
    let mul = 1;
    for (;;) {
      const b = buf[i++]!;
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
    }
  };
  while (i < buf.length) {
    const key = varint();
    if ((key & 7) === 0) out.push([key >> 3, varint()]);
    else {
      const len = varint();
      out.push([key >> 3, buf.subarray(i, i + len)]);
      i += len;
    }
  }
  return out;
}
/** The varints of a packed field. */
function decodePacked(b: Uint8Array): number[] {
  const out: number[] = [];
  let v = 0;
  let mul = 1;
  for (const byte of b) {
    v += (byte & 0x7f) * mul;
    if (byte < 0x80) {
      out.push(v);
      v = 0;
      mul = 1;
    } else mul *= 128;
  }
  return out;
}
const text = (b: number | Uint8Array) => new TextDecoder().decode(b as Uint8Array);
const unzigzag = (n: number) => (n >>> 1) ^ -(n & 1);

describe('traffic light tiles', () => {
  it('puts a tile’s corners where the map expects them', () => {
    const [w, s, e, n] = tileBounds(0, 0, 0);
    expect(w).toBeLessThan(-180);
    expect(e).toBeGreaterThan(180);
    expect(n).toBeGreaterThan(85);
    expect(s).toBeLessThan(-85);
    expect(tilePoint(0, 0, 0, 0, 0)).toEqual([2048, 2048]);
    expect(tilePoint(-180, 85.0511287798, 1, 0, 0)).toEqual([0, 0]);
  });

  it('encodes each light as a point with its kind', () => {
    const z = 16;
    const [x, y] = [60507, 37846];
    const [w, s, e, n] = tileBounds(z, x, y);
    const middle = { id: '12345678901', lon: (w + e) / 2, lat: (s + n) / 2, kind: 'crossing' as const };
    const tile = encodeSignalTile([middle, { id: '2', lon: w, lat: n, kind: 'signals' }], z, x, y);

    const [layerField, layerBytes] = fields(tile)[0] as [number, Uint8Array];
    expect(layerField).toBe(3);
    const layer = fields(layerBytes!);
    expect(layer.find(([f]) => f === 15)![1]).toBe(2); // version
    expect(text(layer.find(([f]) => f === 1)![1])).toBe(SIGNAL_LAYER);
    expect(layer.find(([f]) => f === 5)![1]).toBe(4096);
    expect(layer.filter(([f]) => f === 3).map(([, v]) => text(v))).toEqual(['kind']);
    const values = layer.filter(([f]) => f === 4).map(([, v]) => text(fields(v as Uint8Array)[0]![1]));
    expect(values).toEqual(['signals', 'crossing', 'ramp_meter']);

    const features = layer.filter(([f]) => f === 2).map(([, v]) => fields(v as Uint8Array));
    expect(features).toHaveLength(2);
    const first = features[0]!;
    expect(first.find(([f]) => f === 1)![1]).toBe(12345678901);
    expect(values[decodePacked(first.find(([f]) => f === 2)![1] as Uint8Array)[1]!]).toBe('crossing');
    expect(first.find(([f]) => f === 3)![1]).toBe(1); // a point
    const [command, dx, dy] = decodePacked(first.find(([f]) => f === 4)![1] as Uint8Array);
    expect(command).toBe(9); // MoveTo, once
    expect(Math.abs(unzigzag(dx!) - 2048)).toBeLessThanOrEqual(80);
    expect(Math.abs(unzigzag(dy!) - 2048)).toBeLessThanOrEqual(80);
    // The one at the buffered corner sits just outside the tile.
    const [, cx, cy] = decodePacked(features[1]!.find(([f]) => f === 4)![1] as Uint8Array);
    expect(unzigzag(cx!)).toBeLessThan(0);
    expect(unzigzag(cy!)).toBeLessThan(0);
  });
});
