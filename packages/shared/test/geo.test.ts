import { describe, expect, it } from 'vitest';
import {
  type LngLat,
  bboxOf,
  bearingDeg,
  destination,
  haversineM,
  inEllipse,
  lineLengthM,
  projectOntoSegment,
  sampleLine,
  simplifyLine,
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
