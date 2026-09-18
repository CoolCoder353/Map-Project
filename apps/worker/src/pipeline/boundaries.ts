import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { type AuState, type LngLat, pointInPolygon, simplifyLine, stateAbbreviation } from '@wayfinder/shared';
import type { GeoJsonFeature } from './osm-places.js';

/** One boundary polygon (outer ring + holes), with its bounding box for a cheap first test. */
interface Area<T> {
  value: T;
  level: number;
  polygons: LngLat[][][];
  bbox: [number, number, number, number];
}

/** Polygons bucketed on a lon/lat grid so each lookup only tests the few that could contain it. */
class GridIndex<T> {
  private readonly buckets = new Map<string, Area<T>[]>();
  constructor(private readonly size: number) {}

  private key(ix: number, iy: number) {
    return `${ix}|${iy}`;
  }

  add(area: Area<T>) {
    const [x0, y0, x1, y1] = area.bbox;
    for (let ix = Math.floor(x0 / this.size); ix <= Math.floor(x1 / this.size); ix++) {
      for (let iy = Math.floor(y0 / this.size); iy <= Math.floor(y1 / this.size); iy++) {
        const k = this.key(ix, iy);
        const list = this.buckets.get(k);
        if (list) list.push(area);
        else this.buckets.set(k, [area]);
      }
    }
  }

  /** The containing area with the highest level (most specific), or null. */
  find(p: LngLat): T | null {
    const list = this.buckets.get(this.key(Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)));
    let best: Area<T> | null = null;
    for (const a of list ?? []) {
      if (best && a.level <= best.level) continue;
      const [x0, y0, x1, y1] = a.bbox;
      if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
      if (a.polygons.some((rings) => pointInPolygon(p, rings))) best = a;
    }
    return best?.value ?? null;
  }
}

const STATE_CACHE_DEG = 0.02; // ~2 km squares

/**
 * State and suburb (locality) lookup from OSM administrative boundaries: admin_level 4 for
 * states and territories, 9/10 for suburbs and localities.
 */
export class BoundaryIndex {
  private readonly states = new GridIndex<AuState>(0.5);
  private readonly suburbs = new GridIndex<string>(0.02);
  private readonly stateCache = new Map<string, AuState | null>();
  /** Cache squares a state border passes through; only these need a test per point. */
  private readonly borderSquares = new Set<string>();
  stateCount = 0;
  suburbCount = 0;

  addFeature(f: GeoJsonFeature) {
    const t = f.properties;
    if (t.boundary !== 'administrative' || !f.geometry) return;
    const level = Number(t.admin_level);
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as LngLat[][]]
        : f.geometry.type === 'MultiPolygon'
          ? (f.geometry.coordinates as LngLat[][][])
          : null;
    if (!polys) return;
    if (level === 4) {
      const state = stateAbbreviation({ iso: t['ISO3166-2'] as string | undefined, name: t.name as string | undefined });
      if (!state) return;
      const a = area(state, level, polys, 200);
      this.states.add(a);
      for (const rings of a.polygons) for (const ring of rings) this.markBorder(ring);
      this.stateCount++;
    } else if ((level === 9 || level === 10) && typeof t.name === 'string' && t.name.trim()) {
      this.suburbs.add(area(t.name.trim(), level, polys, 20));
      this.suburbCount++;
    }
  }

  suburb(p: LngLat): string | null {
    return this.suburbs.find(p);
  }

  private markBorder(ring: readonly LngLat[]) {
    const step = STATE_CACHE_DEG / 4;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1]!;
      const [bx, by] = ring[i]!;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / step));
      for (let j = 0; j <= n; j++) {
        const x = ax + ((bx - ax) * j) / n;
        const y = ay + ((by - ay) * j) / n;
        const ix = Math.floor(x / STATE_CACHE_DEG);
        const iy = Math.floor(y / STATE_CACHE_DEG);
        // Mark neighbours too, so a border running along a square's edge is never missed.
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) this.borderSquares.add(`${ix + dx}|${iy + dy}`);
      }
    }
  }

  /**
   * State lookups are cached per ~2 km square. A square no border passes through lies wholly
   * in one state (or wholly at sea), so its centre decides it; border squares are tested per point.
   */
  state(p: LngLat): AuState | null {
    const ix = Math.floor(p[0] / STATE_CACHE_DEG);
    const iy = Math.floor(p[1] / STATE_CACHE_DEG);
    const k = `${ix}|${iy}`;
    if (this.borderSquares.has(k)) return this.states.find(p);
    let cached = this.stateCache.get(k);
    if (cached === undefined) {
      cached = this.states.find([(ix + 0.5) * STATE_CACHE_DEG, (iy + 0.5) * STATE_CACHE_DEG]);
      this.stateCache.set(k, cached);
    }
    return cached;
  }
}

function area<T>(value: T, level: number, polys: LngLat[][][], toleranceM: number): Area<T> {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const polygons = polys.map((rings) =>
    rings.map((ring) => {
      const simple = ring.length > 50 ? simplifyLine(ring, toleranceM) : ring;
      for (const [x, y] of simple) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      return simple;
    }),
  );
  return { value, level, polygons, bbox: [x0, y0, x1, y1] };
}

/** Load an `osmium export -f geojsonseq` file of administrative boundaries. */
export async function loadBoundaries(path: string, log: (m: string) => void = () => undefined): Promise<BoundaryIndex> {
  const index = new BoundaryIndex();
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  const RECORD_SEPARATOR = String.fromCharCode(0x1e); // RFC 8142 GeoJSON text sequences
  for await (const raw of rl) {
    const line = (raw.startsWith(RECORD_SEPARATOR) ? raw.slice(1) : raw).trim();
    if (!line) continue;
    try {
      index.addFeature(JSON.parse(line) as GeoJsonFeature);
    } catch {
      // skip malformed lines
    }
  }
  log(`boundaries: ${index.stateCount} states, ${index.suburbCount} suburbs`);
  return index;
}
