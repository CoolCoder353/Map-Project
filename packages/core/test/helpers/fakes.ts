import type { JobName, JobQueue } from '../../src/services/context.js';
import type { GhPath } from '../../src/lib/graphhopper.js';
import { type LngLat, destination, bearingDeg, haversineM, lineLengthM } from '@wayfinder/shared';

export class FakeQueue implements JobQueue {
  sent: Array<{ name: JobName; data: Record<string, unknown> }> = [];
  async send(name: JobName, data: Record<string, unknown>) {
    this.sent.push({ name, data });
    return String(this.sent.length);
  }
  take(name: JobName) {
    const jobs = this.sent.filter((j) => j.name === name);
    this.sent = this.sent.filter((j) => j.name !== name);
    return jobs;
  }
}

/** A straight-line path through the given points, with instructions at each vertex. */
export function straightPath(points: LngLat[], speedMps: number): GhPath {
  const coords: LngLat[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const n = Math.max(1, Math.ceil(haversineM(a, b) / 100));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) coords.push(destination(a, bearingDeg(a, b), (haversineM(a, b) * k) / n));
  }
  const distance = lineLengthM(coords);
  return {
    distance,
    time: (distance / speedMps) * 1000,
    points: { type: 'LineString', coordinates: coords },
    instructions: [
      { distance, sign: 0, interval: [0, coords.length - 1], text: 'Continue', time: (distance / speedMps) * 1000, street_name: 'Test Road' },
      { distance: 0, sign: 4, interval: [coords.length - 1, coords.length - 1], text: 'Arrive at destination', time: 0 },
    ],
  };
}
