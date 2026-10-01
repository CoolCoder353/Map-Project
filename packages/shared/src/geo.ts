/** [longitude, latitude] in degrees, GeoJSON order. */
export type LngLat = [lon: number, lat: number];

export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthM(coords: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1]!, coords[i]!);
  return total;
}

/** Linear interpolation in degrees; accurate enough for the short segments of a route. */
export function interpolate(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Initial bearing from a to b in degrees [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached travelling distanceM from origin along an initial bearing. */
export function destination(origin: LngLat, bearing: number, distanceM: number): LngLat {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearing);
  const φ1 = toRad(origin[1]);
  const λ1 = toRad(origin[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)];
}

export interface Sample {
  point: LngLat;
  /** Length of line this sample represents, in metres. */
  lengthM: number;
}

/**
 * Walk a polyline in steps of ~stepM and return the midpoint of each step with the
 * length it covers. Sum of lengthM equals the line length.
 */
export function sampleLine(coords: readonly LngLat[], stepM: number): Sample[] {
  const out: Sample[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const len = haversineM(a, b);
    if (len === 0) continue;
    const pieces = Math.max(1, Math.ceil(len / stepM));
    for (let k = 0; k < pieces; k++) {
      out.push({ point: interpolate(a, b, (k + 0.5) / pieces), lengthM: len / pieces });
    }
  }
  return out;
}

export interface SegmentProjection {
  point: LngLat;
  /** Position along the segment, clamped to [0, 1]. */
  t: number;
  distanceM: number;
}

/** Closest point on segment ab to p, using a local equirectangular projection. */
export function projectOntoSegment(p: LngLat, a: LngLat, b: LngLat): SegmentProjection {
  const kx = Math.cos(toRad(p[1])) * EARTH_RADIUS_M * (Math.PI / 180);
  const ky = EARTH_RADIUS_M * (Math.PI / 180);
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : -(ax * dx + ay * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { point: interpolate(a, b, t), t, distanceM: Math.hypot(cx, cy) };
}

/** Distance from p to the nearest point of a line (a single point counts as a line). */
export function distanceToLineM(p: LngLat, line: readonly LngLat[]): number {
  if (line.length === 1) return haversineM(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, projectOntoSegment(p, line[i - 1]!, line[i]!).distanceM);
  return best;
}

/** How much of `line` lies farther than toleranceM from all of `others`, measured every few metres. */
export function uncoveredLengthM(line: readonly LngLat[], others: ReadonlyArray<readonly LngLat[]>, toleranceM = 10): number {
  let total = 0;
  for (const s of sampleLine(line, 5)) {
    if (!others.some((o) => o.length > 0 && distanceToLineM(s.point, o) <= toleranceM)) total += s.lengthM;
  }
  return total;
}

/**
 * Add stretches of one road to those already travelled. A stretch already travelled adds nothing,
 * and one that takes in an earlier stretch replaces it. Returns the stretches and how many new
 * metres of the road they add.
 */
export function mergeStretches(
  existing: ReadonlyArray<LngLat[]>,
  incoming: ReadonlyArray<LngLat[]>,
  toleranceM = 10,
): { stretches: LngLat[][]; addedM: number } {
  let stretches = [...existing];
  let addedM = 0;
  for (const line of incoming) {
    if (line.length < 2) continue;
    const extra = uncoveredLengthM(line, stretches, toleranceM);
    if (extra < 1) continue;
    stretches = stretches.filter((s) => uncoveredLengthM(s, [line], toleranceM) >= 1);
    stretches.push(line);
    addedM += extra;
  }
  return { stretches, addedM };
}

/** Is p inside the ellipse with foci a and b whose focal-distance sum is at most maxSumM? */
export function inEllipse(p: LngLat, a: LngLat, b: LngLat, maxSumM: number): boolean {
  return haversineM(p, a) + haversineM(p, b) <= maxSumM;
}

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export function bboxOf(coords: readonly LngLat[], padM = 0): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  if (padM > 0) {
    const dLat = toDeg(padM / EARTH_RADIUS_M);
    const dLon = dLat / Math.max(0.01, Math.cos(toRad((minLat + maxLat) / 2)));
    minLon -= dLon;
    maxLon += dLon;
    minLat -= dLat;
    maxLat += dLat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Douglas–Peucker simplification of a ring or line (tolerance in metres). */
export function simplifyLine(coords: readonly LngLat[], toleranceM: number): LngLat[] {
  if (coords.length <= 2 || toleranceM <= 0) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOntoSegment(coords[i]!, coords[s]!, coords[e]!).distanceM;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i] === 1);
}

/** Ray-casting point-in-polygon for a single ring. */
export function pointInRing(p: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in a GeoJSON-style polygon: inside the outer ring and outside every hole. */
export function pointInPolygon(p: LngLat, rings: readonly (readonly LngLat[])[]): boolean {
  if (!rings[0] || !pointInRing(p, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i]!)) return false;
  return true;
}

/** A stretch of route geometry, from point index `from` to `to`, with a known speed limit. */
export interface SpeedLimitRun {
  from: number;
  to: number;
  kmh: number;
}

/** Unknown stretches shorter than this, between two known ones, keep the limit before them. */
const SPEED_LIMIT_GAP_M = 60;

/**
 * Speed limits along a route, from the routing engine's `max_speed` runs
 * ([first point, last point, km/h or null]). Roads with no limit mapped are left out rather
 * than guessed, except for a short unknown stretch between two known roads (usually a junction
 * or roundabout), which keeps the limit before it so a sign doesn't flicker off at every corner.
 */
export function speedLimitRuns(coords: readonly LngLat[], runs: ReadonlyArray<readonly [number, number, number | null]>): SpeedLimitRun[] {
  const usable = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0 && v <= 130;
  const out: SpeedLimitRun[] = [];
  runs.forEach(([from, to, kmh], i) => {
    if (usable(kmh)) {
      const prev = out.at(-1);
      const limit = Math.round(kmh);
      if (prev && prev.to === from && prev.kmh === limit) prev.to = to;
      else out.push({ from, to, kmh: limit });
      return;
    }
    const prev = out.at(-1);
    const next = runs[i + 1];
    const short = lineLengthM(coords.slice(from, to + 1)) < SPEED_LIMIT_GAP_M;
    if (prev && prev.to === from && next && usable(next[2]) && short) prev.to = to;
  });
  return out;
}
