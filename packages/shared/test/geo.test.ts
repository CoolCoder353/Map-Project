import { describe, expect, it } from 'vitest';
import {
  type LngLat,
  bboxOf,
  bearingDeg,
  destination,
  haversineM,
  inEllipse,
  lineLengthM,
  mergeStretches,
  projectOntoSegment,
  sampleLine,
  simplifyLine,
  speedLimitRuns,
} from '../src/geo.js';

const civic: LngLat = [149.1310, -35.2809];
const belconnen: LngLat = [149.0653, -35.2386];

describe('geo', () => {
  it('computes haversine distance', () => {
    // Civic to Belconnen is roughly 7.6 km as the crow flies
    expect(haversineM(civic, belconnen)).toBeGreaterThan(7300);
    expect(haversineM(civic, belconnen)).toBeLessThan(7900);
    expect(haversineM(civic, civic)).toBe(0);
  });

  it('destination inverts bearing + distance', () => {
    const d = haversineM(civic, belconnen);
    const b = bearingDeg(civic, belconnen);
    const p = destination(civic, b, d);
    expect(haversineM(p, belconnen)).toBeLessThan(1);
  });

  it('samples a line preserving total length', () => {
    const line: LngLat[] = [civic, belconnen];
    const samples = sampleLine(line, 50);
    const sum = samples.reduce((n, s) => n + s.lengthM, 0);
    expect(sum).toBeCloseTo(lineLengthM(line), 6);
    expect(samples.length).toBe(Math.ceil(lineLengthM(line) / 50));
  });

  it('projects a point onto a segment', () => {
    const a: LngLat = [149.0, -35.0];
    const b: LngLat = [149.01, -35.0];
    const p: LngLat = [149.005, -35.0009]; // ~100 m south of the midpoint
    const r = projectOntoSegment(p, a, b);
    expect(r.t).toBeCloseTo(0.5, 2);
    expect(r.distanceM).toBeGreaterThan(95);
    expect(r.distanceM).toBeLessThan(105);
    expect(projectOntoSegment([148.99, -35], a, b).t).toBe(0);
  });

  it('ellipse membership', () => {
    const d = haversineM(civic, belconnen);
    const mid: LngLat = [(civic[0] + belconnen[0]) / 2, (civic[1] + belconnen[1]) / 2];
    expect(inEllipse(mid, civic, belconnen, d * 1.01)).toBe(true);
    expect(inEllipse([149.3, -35.5], civic, belconnen, d * 1.2)).toBe(false);
  });

  it('bbox with padding', () => {
    const [minLon, minLat, maxLon, maxLat] = bboxOf([civic, belconnen], 1000);
    expect(minLon).toBeLessThan(belconnen[0]);
    expect(maxLat).toBeGreaterThan(belconnen[1]);
    expect(maxLon).toBeGreaterThan(civic[0]);
    expect(minLat).toBeLessThan(civic[1]);
  });

  it('simplifies a near-straight line', () => {
    const pts: LngLat[] = Array.from({ length: 50 }, (_, i) => [149 + i * 0.001, -35 + (i % 2) * 0.000001]);
    const s = simplifyLine(pts, 5);
    expect(s.length).toBe(2);
    expect(s[0]).toEqual(pts[0]);
    expect(s[1]).toEqual(pts[49]);
  });
});

describe('mergeStretches', () => {
  // One straight 2 km road heading east, as points every 100 m.
  const road = Array.from({ length: 21 }, (_, i) => destination([153, -27.5], 90, i * 100));
  const km = (m: number) => Math.round(m / 100) / 10;

  it('keeps separate stretches of one road, and counts each once', () => {
    const west = road.slice(0, 6);
    const east = road.slice(14);
    const first = mergeStretches([], [west]);
    expect(km(first.addedM)).toBe(0.5);
    const both = mergeStretches(first.stretches, [east]);
    expect(both.stretches).toEqual([west, east]);
    expect(km(both.addedM)).toBe(0.6);
  });

  it('adds only the new part of an overlapping stretch, and nothing for one already travelled', () => {
    const middle = mergeStretches([road.slice(0, 11)], [road.slice(5, 16)]);
    expect(middle.stretches).toHaveLength(2);
    expect(km(middle.addedM)).toBe(0.5);
    // GPS-snapped ends differ by a metre or two from trip to trip; still the same stretch.
    const again = mergeStretches(middle.stretches, [road.slice(2, 9).map(([lon, lat]) => [lon, lat + 0.00001] as LngLat)]);
    expect(again.stretches).toEqual(middle.stretches);
    expect(again.addedM).toBe(0);
  });

  it('replaces stretches that a longer one takes in', () => {
    const merged = mergeStretches([road.slice(2, 5), road.slice(8, 12)], [road]);
    expect(merged.stretches).toEqual([road]);
    expect(km(merged.addedM)).toBe(1.5);
    expect(mergeStretches([], [[road[0]!]]).stretches).toEqual([]);
  });
});

describe('speedLimitRuns', () => {
  // Ten 20 m steps east: points 0..10.
  const line: LngLat[] = Array.from({ length: 11 }, (_, i) => destination(civic, 90, i * 20));

  it('keeps known limits, joining neighbouring stretches with the same one', () => {
    expect(speedLimitRuns(line, [[0, 3, 60], [3, 6, 60], [6, 10, 80]])).toEqual([
      { from: 0, to: 6, kmh: 60 },
      { from: 6, to: 10, kmh: 80 },
    ]);
  });

  it('carries a limit across a short unknown stretch, like a junction, but not a long one', () => {
    // 40 m unknown between two known roads: the earlier limit carries on to the next.
    expect(speedLimitRuns(line, [[0, 3, 60], [3, 5, null], [5, 10, 80]])).toEqual([
      { from: 0, to: 5, kmh: 60 },
      { from: 5, to: 10, kmh: 80 },
    ]);
    // 100 m unknown: no limit is shown there.
    expect(speedLimitRuns(line, [[0, 2, 60], [2, 7, null], [7, 10, 60]])).toEqual([
      { from: 0, to: 2, kmh: 60 },
      { from: 7, to: 10, kmh: 60 },
    ]);
    // Unknown at the start or end stays unknown.
    expect(speedLimitRuns(line, [[0, 1, null], [1, 9, 50], [9, 10, null]])).toEqual([{ from: 1, to: 9, kmh: 50 }]);
  });

  it('ignores values that are not a usable limit', () => {
    expect(speedLimitRuns(line, [[0, 5, 0], [5, 8, Number.POSITIVE_INFINITY], [8, 10, 200]])).toEqual([]);
    expect(speedLimitRuns(line, [])).toEqual([]);
  });
});
