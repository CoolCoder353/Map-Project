import { describe, expect, it } from 'vitest';
import { type LngLat, type WayLanes, approachLanes, destination, laneAdvice, lanePreferences, lanesForTurn, parseTurnLanes, withLanes } from '../src/index.js';

describe('reading turn:lanes', () => {
  it('reads each lane’s arrows left to right', () => {
    expect(parseTurnLanes('left|through|through;right')).toEqual([['left'], ['straight'], ['straight', 'right']]);
    // Unmarked and merging lanes go on ahead.
    expect(parseTurnLanes('left||none|merge_to_left')).toEqual([['left'], ['straight'], ['straight'], ['straight']]);
    expect(parseTurnLanes('reverse;left|slight_right')).toEqual([['uTurn', 'left'], ['slightRight']]);
  });

  it('gives nothing for a value it can’t read or that isn’t lanes', () => {
    expect(parseTurnLanes(null)).toBeNull();
    expect(parseTurnLanes('left')).toBeNull();
    expect(parseTurnLanes('left|sideways')).toBeNull();
    expect(parseTurnLanes(Array(13).fill('through').join('|'))).toBeNull();
  });
});

describe('which lanes suit a turn', () => {
  const lanes = parseTurnLanes('left|through|through;right|right')!;

  it('marks the lanes to be in', () => {
    expect(lanesForTurn(lanes, -2)!.map((l) => l.valid)).toEqual([true, false, false, false]);
    expect(lanesForTurn(lanes, 2)!.map((l) => l.valid)).toEqual([false, false, true, true]);
    expect(lanesForTurn(lanes, 0)!.map((l) => l.valid)).toEqual([false, true, true, false]);
    expect(lanesForTurn(lanes, 2)![2]).toEqual({ directions: ['straight', 'right'], valid: true });
  });

  it('falls back to a near direction when none is marked exactly', () => {
    // A slight left from lanes marked only left and ahead.
    expect(lanesForTurn(lanes, -1)!.map((l) => l.valid)).toEqual([true, false, false, false]);
    // Keeping left where the lanes only go ahead or off to the right.
    expect(lanesForTurn(parseTurnLanes('through|through|slight_right')!, -7)!.map((l) => l.valid)).toEqual([true, true, false]);
  });

  it('says nothing when every lane will do, or none will', () => {
    expect(lanesForTurn(parseTurnLanes('through|through')!, 0)).toBeNull();
    expect(lanesForTurn(parseTurnLanes('through|through')!, -2)).toBeNull();
    // The destination isn't a turn.
    expect(lanesForTurn(lanes, 4)).toBeNull();
  });

  it('takes a roundabout’s lanes by how far round the exit is, and a U-turn from the right', () => {
    expect(lanesForTurn(lanes, 6, 90)!.map((l) => l.valid)).toEqual([true, false, false, false]);
    expect(lanesForTurn(lanes, 6, 180)!.map((l) => l.valid)).toEqual([false, true, true, false]);
    expect(lanesForTurn(lanes, 6, 270)!.map((l) => l.valid)).toEqual([false, false, true, true]);
    expect(lanePreferences(6)).toBeNull();
    expect(lanesForTurn(lanes, -98)!.map((l) => l.valid)).toEqual([false, false, true, true]);
  });
});

describe('the lanes on the road leading to a turn', () => {
  const a: LngLat = [153.0, -27.4];
  const b = destination(a, 90, 400);
  const way: WayLanes = { forward: 'left|through', backward: 'through|right', coords: [a, b] };

  it('takes the lanes for the direction travelled, at the end of the way', () => {
    expect(approachLanes(way, destination(a, 90, 300), b)).toEqual([['left'], ['straight']]);
    expect(approachLanes(way, destination(a, 90, 100), a)).toEqual([['straight'], ['right']]);
  });

  it('gives nothing for a turn part-way along it, or off it', () => {
    expect(approachLanes(way, destination(a, 90, 100), destination(a, 90, 200))).toBeNull();
    expect(approachLanes(way, destination(a, 0, 100), b)).toBeNull();
    expect(approachLanes({ ...way, coords: [a] }, a, b)).toBeNull();
  });

  it('puts the lanes on the turn the way leads into', () => {
    const turn = b;
    const coords: LngLat[] = [a, destination(a, 90, 200), turn, destination(turn, 0, 200)];
    const instructions = [
      { sign: 0, interval: [0, 2] as [number, number], text: 'Head east' },
      { sign: -2, interval: [2, 3] as [number, number], text: 'Turn left' },
      { sign: 4, interval: [3, 3] as [number, number], text: 'Arrive' },
    ];
    const out = withLanes(instructions, coords, [[0, 2, 7], [2, 3, 8]], (id) => (id === 7 ? way : undefined));
    expect(out[1]!.lanes).toEqual([{ directions: ['left'], valid: true }, { directions: ['straight'], valid: false }]);
    expect(out[0]).not.toHaveProperty('lanes');
    expect(out[2]).not.toHaveProperty('lanes');
    // No lanes mapped on the road in: the turn is as it was.
    expect(withLanes(instructions, coords, [[0, 2, 9]], () => undefined)[1]).toBe(instructions[1]);
  });
});

describe('lane advice in words', () => {
  const marks = (s: string) => [...s].map((c) => ({ valid: c === 'x' }));
  it('names lanes at either edge, the middle one, or counts from the left', () => {
    expect(laneAdvice(marks('x...'))).toBe('Use the left lane');
    expect(laneAdvice(marks('xx..'))).toBe('Use the left two lanes');
    expect(laneAdvice(marks('..xx'))).toBe('Use the right two lanes');
    expect(laneAdvice(marks('...x'))).toBe('Use the right lane');
    expect(laneAdvice(marks('.x.'))).toBe('Use the middle lane');
    expect(laneAdvice(marks('.xx.'))).toBe('Use the second or third lane from the left');
    expect(laneAdvice(marks('.x.x.'))).toBe('Use the second or fourth lane from the left');
  });

  it('says nothing when no lane or every lane is marked', () => {
    expect(laneAdvice(marks('...'))).toBeNull();
    expect(laneAdvice(marks('xx'))).toBeNull();
  });
});
