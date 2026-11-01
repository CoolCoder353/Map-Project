/**
 * Traffic lights as Mapbox vector tiles, built on request from the `traffic_signals` table. The
 * OpenMapTiles schema the base tiles follow has no layer for them, and points are simple enough to
 * encode by hand: one layer, one point per light, its kind as the only property.
 */
import type { SignalKind } from '@wayfinder/shared';

export const SIGNAL_LAYER = 'traffic_signals';
/** Lights are only drawn close in; below this zoom a tile has none. */
export const SIGNAL_TILE_MIN_ZOOM = 14;
/** Tiles stop here; the map scales the last ones up beyond it. */
export const SIGNAL_TILE_MAX_ZOOM = 16;
const EXTENT = 4096;
/** Lights just outside a tile go in too, so a light on the edge isn't cut in half. */
const BUFFER = 64;

/** The tile's corners in degrees, with the buffer, as [west, south, east, north]. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const pad = BUFFER / EXTENT;
  const lon = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon(x - pad), lat(y + 1 + pad), lon(x + 1 + pad), lat(y - pad)];
}

/** A point's position inside the tile, in tile units (0 to EXTENT across). */
export function tilePoint(lon: number, lat: number, z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  const px = ((lon + 180) / 360) * n;
  const py = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
  return [Math.round((px - x) * EXTENT), Math.round((py - y) * EXTENT)];
}

class Writer {
  private bytes: number[] = [];

  varint(v: number) {
    let n = v;
    while (n > 0x7f) {
      this.bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.bytes.push(n);
    return this;
  }

  /** A field key: field number and wire type (0 varint, 2 length-delimited). */
  key(field: number, wire: 0 | 2) {
    return this.varint(field * 8 + wire);
  }

  bytesField(field: number, data: Uint8Array | number[]) {
    this.key(field, 2).varint(data.length);
    for (const b of data) this.bytes.push(b);
    return this;
  }

  stringField(field: number, s: string) {
    return this.bytesField(field, new TextEncoder().encode(s));
  }

  packed(field: number, values: number[]) {
    const inner = new Writer();
    for (const v of values) inner.varint(v);
    return this.bytesField(field, inner.finish());
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31);
const KINDS: SignalKind[] = ['signals', 'crossing', 'ramp_meter'];

/** Encode the lights as a one-layer vector tile. */
export function encodeSignalTile(signals: ReadonlyArray<{ id: string; lon: number; lat: number; kind: SignalKind }>, z: number, x: number, y: number): Uint8Array {
  const layer = new Writer().key(15, 0).varint(2).stringField(1, SIGNAL_LAYER);
  for (const s of signals) {
    const [px, py] = tilePoint(s.lon, s.lat, z, x, y);
    const feature = new Writer()
      .key(1, 0)
      .varint(Number(s.id))
      .packed(2, [0, KINDS.indexOf(s.kind)])
      .key(3, 0)
      .varint(1) // POINT
      // MoveTo, once, to the point.
      .packed(4, [(1 & 0x7) | (1 << 3), zigzag(px), zigzag(py)]);
    layer.bytesField(2, feature.finish());
  }
  layer.stringField(3, 'kind');
  for (const kind of KINDS) layer.bytesField(4, new Writer().stringField(1, kind).finish());
  layer.key(5, 0).varint(EXTENT);
  return new Writer().bytesField(3, layer.finish()).finish();
}
