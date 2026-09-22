import { describe, expect, it } from 'vitest';
import { type LngLat, destination, haversineM } from '../src/geo.js';
import { AREA_RES, pathCells, pointToCell } from '../src/h3.js';
import { latLngToCell, gridDisk } from 'h3-js';
import {
  cellOverlap,
  pickExploreViaPoints,
  rankExploreCandidates,
  routeNoveltyByWays,
  rankRoundTripCandidates,
  roundTripBearings,
  roundTripRadiusM,
  roundTripViaPoints,
  routeNovelty,
} from '../src/novelty.js';

const line: LngLat[] = [
  [149.10, -35.28],
  [149.13, -35.28],
];

describe('routeNovelty', () => {
  it('is 100% new when nothing is visited', () => {
    const n = routeNovelty(line, () => false);
    expect(n.noveltyPct).toBeCloseTo(100);
    expect(n.newKm).toBeCloseTo(n.totalKm);
    expect(n.totalKm).toBeGreaterThan(2.5);
    expect(n.retraceRatio).toBe(0);
  });

  it('is 0% new when all cells are visited', () => {
    const visited = new Set(pathCells(line));
    const n = routeNovelty(line, (c) => visited.has(c));
    expect(n.noveltyPct).toBeLessThan(5);
  });

  it('counts roughly half when the first half is visited', () => {
    const mid: LngLat = [149.115, -35.28];
    const visited = new Set(pathCells([line[0]!, mid]));
    const n = routeNovelty(line, (c) => visited.has(c));
    expect(n.noveltyPct).toBeGreaterThan(35);
    expect(n.noveltyPct).toBeLessThan(65);
  });

  it('detects retracing on an out-and-back route', () => {
    const outBack: LngLat[] = [line[0]!, line[1]!, line[0]!];
    const n = routeNovelty(outBack, () => false);
    expect(n.retraceRatio).toBeGreaterThan(0.4);
  });
});

describe('ranking', () => {
  const mk = (id: string, durationS: number, newKm: number, cells: string[]) => ({
    candidate: id,
    durationS,
    novelty: { totalKm: 10, newKm, noveltyPct: newKm * 10, cells, retraceRatio: 0 },
  });
  const cellsA = gridDisk(latLngToCell(-35.28, 149.1, 9), 3);
  const cellsB = gridDisk(latLngToCell(-35.20, 149.0, 9), 3);
  const cellsC = gridDisk(latLngToCell(-35.35, 149.2, 9), 3);
  const fastestCells = gridDisk(latLngToCell(-35.40, 149.3, 9), 3);

  it('drops over-budget and duplicate candidates, ranks by new km', () => {
    const ranked = rankExploreCandidates(
      [
        mk('over-budget', 2000, 9, cellsA),
        mk('good', 1100, 5, cellsA),
        mk('dup-of-good', 1150, 4.9, cellsA),
        mk('other', 1200, 3, cellsB),
        mk('same-as-fastest', 1000, 6, fastestCells),
        mk('nothing-new', 1000, 0, cellsC),
      ],
      { fastestDurationS: 1000, fastestCells, budgetS: 600 },
    );
    expect(ranked.map((r) => r.candidate)).toEqual(['good', 'other']);
  });

  it('round trips must fit the target time', () => {
    const ranked = rankRoundTripCandidates(
      [mk('too-long', 5000, 8, cellsA), mk('fits', 3700, 4, cellsB), mk('fits2', 3500, 2, cellsC)],
      { targetS: 3600 },
    );
    expect(ranked.map((r) => r.candidate)).toEqual(['fits', 'fits2']);
  });

  it('cellOverlap is relative to the smaller set', () => {
    expect(cellOverlap(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(1);
    expect(cellOverlap(['a', 'x'], ['a', 'b'])).toBe(0.5);
    expect(cellOverlap([], ['a'])).toBe(0);
  });
});

describe('via point generation', () => {
  const from: LngLat = [149.0, -35.3];
  const to: LngLat = [149.1, -35.3];

  it('picks unexplored areas inside the ellipse, separated, away from endpoints', () => {
    const direct = haversineM(from, to);
    const areaCells = gridDisk(pointToCell([149.05, -35.3], AREA_RES), 4);
    const areas = areaCells.map((cell, i) => ({ cell, unvisitedFraction: i % 2 ? 0.9 : 0.1 }));
    const vias = pickExploreViaPoints(areas, from, to, direct * 1.5, 4);
    expect(vias.length).toBeGreaterThan(0);
    for (const v of vias) {
      expect(haversineM(v, from) + haversineM(v, to)).toBeLessThanOrEqual(direct * 1.5);
    }
    for (let i = 0; i < vias.length; i++)
      for (let j = i + 1; j < vias.length; j++)
        expect(haversineM(vias[i]!, vias[j]!)).toBeGreaterThanOrEqual(500);
  });

  it('round trip via points lie on a circle through the start', () => {
    const r = roundTripRadiusM(10_000);
    const [v1, v2] = roundTripViaPoints(from, 90, r);
    const centre = destination(from, 90, r);
    expect(haversineM(centre, v1!)).toBeCloseTo(r, -1);
    expect(haversineM(centre, v2!)).toBeCloseTo(r, -1);
    expect(haversineM(centre, from)).toBeCloseTo(r, -1);
  });

  it('prefers directions with unexplored areas and spreads bearings', () => {
    const bearings = roundTripBearings(from, 2000, (p) => (p[0] > from[0] ? 1 : 0), 3);
    expect(bearings).toHaveLength(3);
    // east-ish directions first
    expect(bearings[0]).toBeGreaterThan(0);
    expect(bearings[0]).toBeLessThan(180);
  });
});

describe('novelty by road', () => {
  it('counts kilometres on roads never travelled, and roads repeated within the route', () => {
    const a: LngLat = [153.0, -27.5];
    const b = destination(a, 90, 1000);
    const c = destination(b, 90, 1000);
    const coords = [a, b, c, b];
    const runs = [[0, 1, 111] as const, [1, 2, 222] as const, [2, 3, 222] as const];
    const fallback = { newKm: 0, totalKm: 0, noveltyPct: 0, retraceRatio: 0, cells: ['x'] };
    const n = routeNoveltyByWays(coords, runs, (id) => id === 111, fallback);
    expect(n.totalKm).toBeCloseTo(3, 1);
    expect(n.newKm).toBeCloseTo(2, 1); // way 222 is new, and it is used twice
    expect(n.retraceRatio).toBeCloseTo(1 / 3, 1);
    expect(n.wayIds).toEqual([111, 222]);
    expect(n.cells).toEqual(['x']); // cells still come from the sampled scorer
  });

  it('falls back to the hexagon score when the engine reported no ways', () => {
    const fallback = { newKm: 5, totalKm: 10, noveltyPct: 50, retraceRatio: 0, cells: [] };
    expect(routeNoveltyByWays([[0, 0]], [], () => false, fallback)).toBe(fallback);
  });
});

describe('explore ranking prefers routes people want to drive', () => {
  const novelty = (newKm: number, retraceRatio = 0) => ({ newKm, totalKm: newKm + 10, noveltyPct: 50, retraceRatio, cells: [] as string[] });
  const opts = { fastestDurationS: 1800, fastestCells: [] as string[], budgetS: 1200 };

  it('puts a route with U-turns below a slightly less new one without them', () => {
    const ranked = rankExploreCandidates(
      [
        { candidate: 'uturns', durationS: 1900, novelty: novelty(20), uTurns: 1 },
        { candidate: 'clean', durationS: 2000, novelty: novelty(16), uTurns: 0 },
      ],
      opts,
    );
    expect(ranked.map((r) => r.candidate)).toEqual(['clean', 'uturns']);
  });

  it('does not offer a route that asks for several U-turns', () => {
    const ranked = rankExploreCandidates(
      [
        { candidate: 'two-uturns', durationS: 1900, novelty: novelty(40), uTurns: 2 },
        { candidate: 'one-uturn', durationS: 1900, novelty: novelty(12), uTurns: 1 },
      ],
      opts,
    );
    expect(ranked.map((r) => r.candidate)).toEqual(['one-uturn']);
  });

  it('prefers a loop over an out-and-back with the same new ground', () => {
    const ranked = rankExploreCandidates(
      [
        { candidate: 'out-and-back', durationS: 1900, novelty: novelty(20, 0.8), uTurns: 0 },
        { candidate: 'loop', durationS: 1900, novelty: novelty(18, 0), uTurns: 0 },
      ],
      opts,
    );
    expect(ranked[0]!.candidate).toBe('loop');
  });
});
