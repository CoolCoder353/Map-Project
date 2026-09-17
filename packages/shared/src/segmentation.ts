import { type LngLat, haversineM, lineLengthM } from './geo.js';
import type { Mode } from './schemas/common.js';

export interface TrackPoint {
  /** Epoch milliseconds */
  ts: number;
  lon: number;
  lat: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
}

export const toLngLat = (p: TrackPoint): LngLat => [p.lon, p.lat];

export interface FilterOptions {
  maxAccuracyM?: number;
  /** Anything faster than this between consecutive fixes is a GPS jump (~250 km/h). */
  maxSpeedMps?: number;
}

/** Sort, de-duplicate, and drop inaccurate points and implausible jumps. */
export function filterPoints(points: readonly TrackPoint[], opts: FilterOptions = {}): TrackPoint[] {
  const maxAcc = opts.maxAccuracyM ?? 50;
  const maxSpeed = opts.maxSpeedMps ?? 70;
  const sorted = points
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180 &&
        (p.accuracyM == null || p.accuracyM <= maxAcc),
    )
    .sort((a, b) => a.ts - b.ts);
  const out: TrackPoint[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last) {
      if (p.ts === last.ts) continue;
      const dt = (p.ts - last.ts) / 1000;
      if (haversineM(toLngLat(last), toLngLat(p)) / dt > maxSpeed) continue;
    }
    out.push(p);
  }
  return out;
}

export interface SegmentOptions {
  gapMs?: number;
  stationaryMs?: number;
  stationaryRadiusM?: number;
  minTripDistanceM?: number;
}

/**
 * Split a filtered, time-ordered track into trips. A trip ends at a time gap, or when the
 * device stays within a small radius for too long (the stationary points are discarded).
 */
export function segmentTrips(points: readonly TrackPoint[], opts: SegmentOptions = {}): TrackPoint[][] {
  const gapMs = opts.gapMs ?? 10 * 60_000;
  const stationaryMs = opts.stationaryMs ?? 5 * 60_000;
  const radius = opts.stationaryRadiusM ?? 50;
  const minDist = opts.minTripDistanceM ?? 100;

  const trips: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  const flush = () => {
    if (current.length >= 2 && lineLengthM(current.map(toLngLat)) >= minDist) trips.push(current);
    current = [];
  };

  // Index in `current` where the device most recently came to rest.
  let anchor = 0;
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev && p.ts - prev.ts > gapMs) {
      flush();
      anchor = 0;
    }
    current.push(p);
    const anchorPt = current[anchor]!;
    if (haversineM(toLngLat(anchorPt), toLngLat(p)) > radius) {
      // Moved away from the anchor. If it was a long stop, split there.
      const stoppedFor = prev ? prev.ts - anchorPt.ts : 0;
      if (stoppedFor >= stationaryMs) {
        const before = current.slice(0, anchor + 1);
        const after = [prev!, p];
        current = before;
        flush();
        current = after;
        anchor = 0;
      } else {
        // Advance the anchor to the first point still within radius of p's predecessor chain.
        anchor = current.length - 1;
      }
    }
  }
  // Trailing stop: trim it off the end.
  const tail = current[current.length - 1];
  if (tail && current.length > 1) {
    const anchorPt = current[anchor]!;
    if (tail.ts - anchorPt.ts >= stationaryMs) current = current.slice(0, anchor + 1);
  }
  flush();
  return trips;
}

/** Walking vs driving from typical moving speed (median above 25 km/h means car). */
export function inferMode(points: readonly TrackPoint[]): Mode {
  const speeds: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dt = (b.ts - a.ts) / 1000;
    const s = b.speedMps ?? (dt > 0 ? haversineM(toLngLat(a), toLngLat(b)) / dt : 0);
    if (s > 0.5) speeds.push(s);
  }
  if (speeds.length === 0) return 'foot';
  speeds.sort((x, y) => x - y);
  const median = speeds[Math.floor(speeds.length / 2)]!;
  return median > 25 / 3.6 ? 'car' : 'foot';
}
