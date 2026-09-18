import {
  cellArea,
  cellToChildrenSize,
  cellToLatLng,
  cellToParent,
  cellsToMultiPolygon,
  getHexagonEdgeLengthAvg,
  getResolution,
  gridDisk,
  latLngToCell,
  polygonToCells,
  UNITS,
} from 'h3-js';
import { type BBox, type LngLat, haversineM, interpolate, simplifyLine } from './geo.js';

/** Resolution at which a cell counts as "visited" (~0.1 km², ~200 m across). */
export const VISIT_RES = 9;
/** Resolution of an "area" for suggestions and zoomed-out coverage (~5 km²). */
export const AREA_RES = 7;

export type Cell = string;

export function pointToCell(p: LngLat, res = VISIT_RES): Cell {
  return latLngToCell(p[1], p[0], res);
}

export function cellCenter(cell: Cell): LngLat {
  const [lat, lng] = cellToLatLng(cell);
  return [lng, lat];
}

export function cellToBigInt(cell: Cell): bigint {
  return BigInt(`0x${cell}`);
}

export function bigIntToCell(value: bigint | string): Cell {
  return BigInt(value).toString(16);
}

export function parentCell(cell: Cell, res: number): Cell {
  return cellToParent(cell, res);
}

/** The cell and every cell within `k` steps of it. */
export function diskCells(cell: Cell, k: number): Cell[] {
  return gridDisk(cell, k);
}

export function cellResolution(cell: Cell): number {
  return getResolution(cell);
}

/** Number of VISIT_RES cells contained in a cell of the given resolution. */
export function childCount(cell: Cell, childRes = VISIT_RES): number {
  return cellToChildrenSize(cell, childRes);
}

export function cellAreaKm2(cell: Cell): number {
  return cellArea(cell, UNITS.km2);
}

/**
 * Cells covered by a GPS path. Segments between consecutive fixes are sampled at a third of
 * the cell edge length so a fast-moving car with sparse fixes leaves no gaps.
 * Returns unique cells in first-seen order.
 */
export function pathCells(points: readonly LngLat[], res = VISIT_RES): Cell[] {
  const seen = new Set<Cell>();
  const out: Cell[] = [];
  const add = (c: Cell) => {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };
  const stepM = getHexagonEdgeLengthAvg(res, UNITS.m) / 3;
  let prev: LngLat | undefined;
  for (const p of points) {
    if (prev) {
      const steps = Math.ceil(haversineM(prev, p) / stepM);
      for (let i = 1; i < steps; i++) add(pointToCell(interpolate(prev, p, i / steps), res));
    }
    add(pointToCell(p, res));
    prev = p;
  }
  return out;
}

/** Coverage resolution to use for a given web-map zoom level. */
export function coverageResForZoom(zoom: number): number {
  if (zoom >= 13) return 9;
  if (zoom >= 11.5) return 8;
  if (zoom >= 10) return 7;
  if (zoom >= 8) return 6;
  if (zoom >= 6) return 5;
  return 4;
}

export function bboxToCells(bbox: BBox, res: number): Cell[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const ring: LngLat[] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
  return polygonToCells([ring], res, true);
}

export function polygonCells(ring: readonly LngLat[], res: number): Cell[] {
  return polygonToCells([ring as LngLat[]], res, true);
}

export type GeoJsonMultiPolygon = { type: 'MultiPolygon'; coordinates: LngLat[][][] };

function countVertices(mp: LngLat[][][]): number {
  return mp.reduce((n, poly) => n + poly.reduce((m, ring) => m + ring.length, 0), 0);
}

/** Merge same-resolution cells into a GeoJSON MultiPolygon outline. */
export function cellsToMultiPolygonGeoJson(cells: readonly Cell[]): GeoJsonMultiPolygon {
  if (cells.length === 0) return { type: 'MultiPolygon', coordinates: [] };
  return {
    type: 'MultiPolygon',
    coordinates: cellsToMultiPolygon(cells as Cell[], true) as LngLat[][][],
  };
}

/**
 * Build a compact polygon describing visited cells, suitable for a routing request.
 * Coarsens to parent resolutions (majority-visited parents) and simplifies until the
 * vertex count fits under maxVertices. Returns null if nothing is visited.
 */
export function visitedAreaPolygon(
  visited: readonly Cell[],
  maxVertices = 4000,
): GeoJsonMultiPolygon | null {
  if (visited.length === 0) return null;
  let cells: Cell[] = [...new Set(visited)];
  let res = getResolution(cells[0]!);
  let mp = cellsToMultiPolygonGeoJson(cells).coordinates;
  let tolerance = 10;
  let canCoarsen = true;
  while (countVertices(mp) > maxVertices) {
    if (canCoarsen && res > AREA_RES) {
      // Coarsen: keep parents where at least half the children are visited.
      const counts = new Map<Cell, number>();
      for (const c of cells) {
        const p = cellToParent(c, res - 1);
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      const parents = [...counts].filter(([, n]) => n >= 4).map(([p]) => p);
      if (parents.length === 0) {
        // Too sparse to coarsen without losing everything: simplify instead.
        canCoarsen = false;
        continue;
      }
      cells = parents;
      res -= 1;
      mp = cellsToMultiPolygonGeoJson(cells).coordinates;
      continue;
    }
    // Simplify rings and drop tiny holes, loosening the tolerance each pass.
    mp = mp
      .map((poly) =>
        poly
          .map((ring) => simplifyLine(ring, tolerance))
          .filter((ring, i) => ring.length >= 4 && (i === 0 || ring.length >= 6)),
      )
      .filter((poly) => poly.length > 0);
    tolerance *= 2;
    if (tolerance > 5000) break;
  }
  return { type: 'MultiPolygon', coordinates: mp };
}
