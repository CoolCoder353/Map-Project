import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destination, haversineM } from '@wayfinder/shared';
import { readRoute, replay } from '../../device/route.js';

describe('routes to replay', () => {
  const line = [[153.0, -27.5], [153.01, -27.5]];

  it('reads a GeoJSON line, bare, as a feature, or the first in a collection', () => {
    expect(readRoute(JSON.stringify({ type: 'LineString', coordinates: line }), 'r.geojson')).toEqual(line);
    expect(readRoute(JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }), 'r.json')).toEqual(line);
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }, { type: 'Feature', geometry: { type: 'LineString', coordinates: line } }] };
    expect(readRoute(JSON.stringify(fc), 'r.geojson')).toEqual(line);
  });

  it('reads a GPX track or route as [lon, lat]', () => {
    const gpx = '<gpx><trk><trkseg><trkpt lat="-27.5" lon="153.0"><time>2026-11-09T00:00:00Z</time></trkpt><trkpt lon="153.01" lat="-27.5"/></trkseg></trk></gpx>';
    expect(readRoute(gpx, 'Drive.GPX')).toEqual(line);
    expect(readRoute('<gpx><rte><rtept lat="-27.5" lon="153.0"/></rte></gpx>', 'r.gpx')).toEqual([[153.0, -27.5]]);
  });

  it('refuses a file with no route, or a point off the Earth', () => {
    expect(() => readRoute('{"type":"Point","coordinates":[0,0]}', 'p.geojson')).toThrow('No route found');
    expect(() => readRoute('<gpx/>', 'e.gpx')).toThrow('No route found');
    expect(() => readRoute(JSON.stringify({ type: 'LineString', coordinates: [[-27.5, 153]] }), 'swapped.geojson')).toThrow("isn't on Earth");
  });

  it('gives a fix a second along the line at the speed asked, ending stopped at the end', () => {
    const start = [153.0, -27.5] as const;
    const end = destination([...start], 90, 1000);
    const fixes = replay([[...start], end], 36); // 10 m/s
    expect(fixes).toHaveLength(101);
    expect(fixes[0]).toMatchObject({ lon: 153.0, lat: -27.5, atS: 0, speedMps: 10 });
    expect(fixes[1]!.bearingDeg).toBeCloseTo(90, 0);
    expect(haversineM([fixes[0]!.lon, fixes[0]!.lat], [fixes[1]!.lon, fixes[1]!.lat])).toBeCloseTo(10, 1);
    expect(fixes.at(-1)).toMatchObject({ atS: 100, speedMps: 0 });
    expect(haversineM([fixes.at(-1)!.lon, fixes.at(-1)!.lat], end)).toBeLessThan(0.01);
  });

  it('turns with the line, and copes with a line shorter than a step or of one point', () => {
    const a: [number, number] = [153.0, -27.5];
    const b = destination(a, 90, 50);
    const c = destination(b, 180, 50);
    const fixes = replay([a, b, c], 36);
    expect(fixes[2]!.bearingDeg).toBeCloseTo(90, 0);
    expect(fixes[8]!.bearingDeg).toBeCloseTo(180, 0);
    expect(replay([a, destination(a, 90, 3)], 36)).toHaveLength(2);
    expect(replay([a], 36)).toEqual([{ lon: 153.0, lat: -27.5, atS: 0, speedMps: 0, bearingDeg: 0 }]);
    expect(() => replay([a, b], 0)).toThrow('above 0');
  });
});

it('reads the checked-in sample route', () => {
  const file = resolve(import.meta.dirname, '../../device/routes/brisbane-to-mt-coot-tha.geojson');
  const line = readRoute(readFileSync(file, 'utf8'), file);
  expect(line[0]).toEqual([153.0251, -27.4698]);
  expect(replay(line, 50).length).toBeGreaterThan(400);
});
