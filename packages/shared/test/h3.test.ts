import { gridDisk, areNeighborCells, getResolution } from 'h3-js';
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../src/geo.js';
import {
  AREA_RES,
  VISIT_RES,
  bigIntToCell,
  bboxToCells,
  cellToBigInt,
  cellsToMultiPolygonGeoJson,
  childCount,
  coverageResForZoom,
  parentCell,
  pathCells,
  pointToCell,
  visitedAreaPolygon,
} from '../src/h3.js';

describe('h3 helpers', () => {
  it('round-trips cells through bigint', () => {
    const c = pointToCell([149.13, -35.28]);
    const n = cellToBigInt(c);
    expect(n > 0n).toBe(true);
    expect(n < 2n ** 63n).toBe(true); // fits Postgres bigint
    expect(bigIntToCell(n)).toBe(c);
    expect(bigIntToCell(n.toString())).toBe(c);
  });

  it('pathCells leaves no gaps between distant fixes', () => {
    // (sampling at a third of the edge length yields a connected chain of neighbours)
    // Two fixes ~2 km apart (a car at speed with sparse GPS)
    const cells = pathCells([
      [149.10, -35.28],
      [149.12, -35.28],
    ]);
    expect(cells.length).toBeGreaterThan(5);
    for (let i = 1; i < cells.length; i++) {
      expect(areNeighborCells(cells[i - 1]!, cells[i]!)).toBe(true);
    }
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('pathCells of a stationary device is a single cell', () => {
    const p: LngLat = [149.13, -35.28];
    expect(pathCells([p, p, p])).toEqual([pointToCell(p)]);
  });

  it('chooses coverage resolution by zoom', () => {
    expect(coverageResForZoom(15)).toBe(9);
    expect(coverageResForZoom(12)).toBe(8);
    expect(coverageResForZoom(10)).toBe(7);
    expect(coverageResForZoom(3)).toBe(4);
  });

  it('counts children and parents', () => {
    const c = pointToCell([149.13, -35.28]);
    const p = parentCell(c, AREA_RES);
    expect(getResolution(p)).toBe(AREA_RES);
    expect(childCount(p, VISIT_RES)).toBe(49);
  });

  it('lists cells in a bbox', () => {
    const cells = bboxToCells([149.10, -35.30, 149.12, -35.28], 9);
    expect(cells.length).toBeGreaterThan(20);
  });

  it('merges adjacent cells into one polygon', () => {
    const disk = gridDisk(pointToCell([149.13, -35.28]), 2);
    const mp = cellsToMultiPolygonGeoJson(disk);
    expect(mp.coordinates.length).toBe(1);
    expect(mp.coordinates[0]![0]!.length).toBeGreaterThan(6);
  });

  it('visitedAreaPolygon respects the vertex cap by coarsening/simplifying', () => {
    // Scatter many disconnected single cells: worst case for vertex count
    const base = pointToCell([149.13, -35.28]);
    const scattered = gridDisk(base, 60).filter((_, i) => i % 3 === 0);
    const count = (mp: { coordinates: LngLat[][][] }) =>
      mp.coordinates.flat(2).length;
    const raw = cellsToMultiPolygonGeoJson(scattered);
    expect(count(raw)).toBeGreaterThan(2000);
    const capped = visitedAreaPolygon(scattered, 2000);
    expect(capped).not.toBeNull();
    expect(count(capped!)).toBeLessThanOrEqual(2000);
    expect(visitedAreaPolygon([])).toBeNull();
  });
});
