import { describe, expect, it } from 'vitest';
import { BoundaryIndex } from '../../src/pipeline/boundaries.js';

const square = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const boundary = (props: Record<string, string>, coordinates: unknown, type = 'Polygon') => ({
  type: 'Feature' as const,
  properties: { boundary: 'administrative', ...props },
  geometry: { type, coordinates },
});

function index() {
  const b = new BoundaryIndex();
  // "ACT" is x < 149.2305, "NSW" to its east; the border passes 1 km inside a 2 km cache square.
  b.addFeature(boundary({ admin_level: '4', 'ISO3166-2': 'AU-ACT', name: 'Australian Capital Territory' }, square(148.7, -35.9, 149.2305, -35.1)));
  b.addFeature(boundary({ admin_level: '4', name: 'New South Wales' }, square(149.2305, -36.5, 150.5, -34.5)));
  b.addFeature(boundary({ admin_level: '10', name: 'Queanbeyan' }, square(149.2305, -35.4, 149.26, -35.33)));
  b.addFeature(boundary({ admin_level: '10', name: 'Braddon' }, square(149.12, -35.28, 149.14, -35.26)));
  b.addFeature(boundary({ admin_level: '8', name: 'Queanbeyan-Palerang' }, square(149.2305, -36, 150, -35)));
  b.addFeature(boundary({ admin_level: '10', name: 'Line' }, [[149, -35], [149.1, -35]], 'LineString'));
  return b;
}

describe('BoundaryIndex', () => {
  it('finds the state on each side of a border that clips a cache square', () => {
    const b = index();
    expect(b.state([149.2295, -35.35])).toBe('ACT');
    expect(b.state([149.2315, -35.35])).toBe('NSW');
    // Cached squares away from the border.
    expect(b.state([149.13, -35.27])).toBe('ACT');
    expect(b.state([149.13, -35.27])).toBe('ACT');
    expect(b.state([150.0, -35.0])).toBe('NSW');
    expect(b.state([160, -35])).toBeNull();
  });

  it('finds suburbs from locality polygons and ignores other levels and non-areas', () => {
    const b = index();
    expect(b.suburb([149.24, -35.35])).toBe('Queanbeyan');
    expect(b.suburb([149.13, -35.27])).toBe('Braddon');
    expect(b.suburb([149.5, -35.5])).toBeNull(); // only the admin_level 8 council covers it
    expect(b.suburbCount).toBe(2);
    expect(b.stateCount).toBe(2);
  });
});
