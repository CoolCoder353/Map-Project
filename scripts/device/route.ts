import { type LngLat, bearingDeg, haversineM, interpolate } from '@wayfinder/shared';

/** A position to replay: where, seconds from the start, speed and heading. */
export interface Fix {
  lon: number;
  lat: number;
  atS: number;
  speedMps: number;
  bearingDeg: number;
}

/** The line of a GeoJSON LineString (bare, a Feature, or the first in a FeatureCollection) or of a GPX track or route, as [lon, lat]. */
export function readRoute(text: string, fileName: string): LngLat[] {
  const line = fileName.toLowerCase().endsWith('.gpx') ? fromGpx(text) : fromGeoJson(JSON.parse(text) as unknown);
  if (line.length === 0) throw new Error(`No route found in ${fileName}`);
  for (const [lon, lat] of line) {
    if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) throw new Error(`${fileName} has a point that isn't on Earth: ${lon},${lat}`);
  }
  return line;
}

function fromGpx(xml: string): LngLat[] {
  const pts: LngLat[] = [];
  for (const m of xml.matchAll(/<(?:trkpt|rtept)\b([^>]*)>/g)) {
    const lat = /\blat="([^"]+)"/.exec(m[1]!)?.[1];
    const lon = /\blon="([^"]+)"/.exec(m[1]!)?.[1];
    if (lat !== undefined && lon !== undefined) pts.push([Number(lon), Number(lat)]);
  }
  return pts;
}

function fromGeoJson(g: unknown): LngLat[] {
  const o = g as { type?: string; coordinates?: LngLat[]; geometry?: unknown; features?: unknown[] } | null;
  if (o?.type === 'LineString') return o.coordinates ?? [];
  if (o?.type === 'Feature') return fromGeoJson(o.geometry);
  if (o?.type === 'FeatureCollection') {
    for (const f of o.features ?? []) {
      const l = fromGeoJson(f);
      if (l.length) return l;
    }
  }
  return [];
}

/** A fix every `stepS` seconds along the line at `speedKmh`, from its start to a stop at its end. */
export function replay(line: readonly LngLat[], speedKmh: number, stepS = 1): Fix[] {
  if (!(speedKmh > 0)) throw new Error('Speed must be above 0 km/h');
  const speedMps = speedKmh / 3.6;
  const legs: Array<{ a: LngLat; b: LngLat; len: number; bearing: number }> = [];
  for (let i = 1; i < line.length; i++) {
    const len = haversineM(line[i - 1]!, line[i]!);
    if (len > 0) legs.push({ a: line[i - 1]!, b: line[i]!, len, bearing: bearingDeg(line[i - 1]!, line[i]!) });
  }
  if (legs.length === 0) {
    const [lon, lat] = line[0]!;
    return [{ lon, lat, atS: 0, speedMps: 0, bearingDeg: 0 }];
  }
  const total = legs.reduce((sum, l) => sum + l.len, 0);
  const fixes: Fix[] = [];
  let leg = 0;
  let legStart = 0;
  for (let k = 0; ; k++) {
    const d = Math.min(k * speedMps * stepS, total);
    while (leg < legs.length - 1 && d > legStart + legs[leg]!.len) {
      legStart += legs[leg]!.len;
      leg++;
    }
    const l = legs[leg]!;
    const [lon, lat] = interpolate(l.a, l.b, Math.min(1, (d - legStart) / l.len));
    const last = d >= total - 0.01; // within a centimetre: the end, whatever the rounding
    fixes.push({ lon, lat, atS: k * stepS, speedMps: last ? 0 : speedMps, bearingDeg: l.bearing });
    if (last) return fixes;
  }
}
