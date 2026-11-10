import type { LngLat } from '@wayfinder/shared/geo';

/** Where along a route its label may go, as shares of its length: the middle first. */
const CANDIDATES = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

/** Metres between two nearby points, flat-earth: plenty for picking the clearer of two spots. */
function metres(a: LngLat, b: LngLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dx = (a[0] - b[0]) * 111_320 * k;
  const dy = (a[1] - b[1]) * 110_540;
  return Math.hypot(dx, dy);
}

/** The point [share] of the way along a line. */
export function pointAlong(line: LngLat[], share: number): LngLat {
  const legs: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = metres(line[i - 1]!, line[i]!);
    legs.push(d);
    total += d;
  }
  let left = total * share;
  for (let i = 0; i < legs.length; i++) {
    const d = legs[i]!;
    if (left <= d && d > 0) {
      const f = left / d;
      const a = line[i]!;
      const b = line[i + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    left -= d;
  }
  return line[line.length - 1]!;
}

/** How far a point is from the nearest vertex of any of the lines. */
function clearance(p: LngLat, lines: LngLat[][]): number {
  let best = Infinity;
  for (const l of lines) for (const v of l) best = Math.min(best, metres(p, v));
  return best;
}

/**
 * Where to put each route's label ("24 min") so it sits on its own line, away from the others:
 * routes that share roads would otherwise put their labels on the same stretch, and a label
 * couldn't be told to belong to one line rather than another (U5). Of a few spots along each
 * route, the one furthest from the other routes, and from labels already placed, wins.
 */
export function routeLabelPoints(routes: ReadonlyArray<{ id: string; geometry: LngLat[] }>): Map<string, LngLat> {
  const out = new Map<string, LngLat>();
  const usable = routes.filter((r) => r.geometry.length > 1);
  for (const r of usable) {
    const others = usable.filter((o) => o !== r).map((o) => o.geometry);
    const placed = [...out.values()].map((p) => [p]);
    let best: LngLat = pointAlong(r.geometry, 0.5);
    let bestScore = -1;
    for (const share of CANDIDATES) {
      const p = pointAlong(r.geometry, share);
      const score = Math.min(clearance(p, others), clearance(p, placed));
      // The middle wins ties, and anything clear by 100 m is clear enough.
      if (score > bestScore + 1) {
        best = p;
        bestScore = score;
      }
      if (bestScore >= 100 && share === 0.5) break;
    }
    out.set(r.id, best);
  }
  return out;
}
