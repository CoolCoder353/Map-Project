/// <reference types="jest" />
import { pointAlong, routeLabelPoints } from '../src/map/routeLabels';

describe('route labels (U5)', () => {
  it('finds the point a share of the way along a line', () => {
    expect(pointAlong([[153, -27.5], [153.01, -27.5]], 0.5)[0]).toBeCloseTo(153.005, 6);
    expect(pointAlong([[153, -27.5], [153.01, -27.5]], 1)).toEqual([153.01, -27.5]);
  });

  it('puts each label on its own stretch, not where routes share a road', () => {
    // Two routes on one road for their first half, then apart: west and east of 153.01.
    const shared: [number, number][] = [[153, -27.5], [153.005, -27.5], [153.01, -27.5]];
    const a = { id: 'a', geometry: [...shared, [153.01, -27.48], [153.02, -27.48]] as [number, number][] };
    const b = { id: 'b', geometry: [...shared, [153.01, -27.52], [153.02, -27.52]] as [number, number][] };
    const at = routeLabelPoints([a, b]);
    // Both off the shared road, one north of it and one south.
    expect(at.get('a')![1]).toBeGreaterThan(-27.499);
    expect(at.get('b')![1]).toBeLessThan(-27.501);
  });

  it('keeps a lone route’s label in its middle, and skips lines with one point', () => {
    const at = routeLabelPoints([{ id: 'r', geometry: [[153, -27.5], [153.02, -27.5]] }, { id: 'x', geometry: [[153, -27.5]] }]);
    expect(at.get('r')![0]).toBeCloseTo(153.01, 6);
    expect(at.has('x')).toBe(false);
  });
});
