import { describe, expect, it } from 'vitest';
import { MANEUVER_PATH, maneuverTypeOf, roundaboutDrawing } from '../src/maneuvers.js';

/** The numbers in a path, as [x, y] pairs. */
const points = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).reduce<number[][]>((out, n, i) => (i % 2 ? (out.at(-1)!.push(n), out) : [...out, [n]]), []);

describe('turns', () => {
  it('tell keep, slight and sharp turns apart, as the car does', () => {
    expect([-7, -1, -2, -3, 7, 1, 2, 3].map(maneuverTypeOf)).toEqual(['keepLeft', 'slightLeft', 'left', 'sharpLeft', 'keepRight', 'slightRight', 'right', 'sharpRight']);
    expect([0, 4, 5, 6, -6, -8, 8, -98].map(maneuverTypeOf)).toEqual(['straight', 'destination', 'waypoint', 'roundabout', 'roundaboutExit', 'uTurnLeft', 'uTurnRight', 'uTurnRight']);
    // A sign a newer engine adds is drawn as straight on.
    expect(maneuverTypeOf(42)).toBe('straight');
    // Fifteen kinds of turn, drawn in thirteen shapes: roundabouts in and out, and waypoints and the end, share one.
    expect(new Set(Object.values(MANEUVER_PATH)).size).toBe(13);
  });

  it('draw a roundabout clockwise to the exit taken', () => {
    // Left turn: out to the left; straight on: out of the top; right: out to the right.
    const armEnd = (angle: number) => points(roundaboutDrawing(angle).taken).at(-1)!;
    const [lx, ly] = armEnd(90);
    expect(lx).toBeLessThan(100);
    expect(ly).toBeCloseTo(480, 0);
    const [sx, sy] = armEnd(180);
    expect(sx).toBeCloseTo(480, 0);
    expect(sy).toBeLessThan(100);
    expect(armEnd(270)[0]).toBeGreaterThan(860);
    // In from the bottom.
    expect(points(roundaboutDrawing(90).taken)[0]).toEqual([480, 930]);
    // All the way round: nothing left of the ring to draw faint. Out-of-range angles are kept in range.
    expect(roundaboutDrawing(360).rest).toBe('');
    expect(roundaboutDrawing(400)).toEqual(roundaboutDrawing(360));
    expect(roundaboutDrawing(0).rest).not.toBe('');
  });
});
