import { describe, expect, it } from 'vitest';
import type { LngLat } from '@wayfinder/shared';
import { discoverBands, doubledBackShare, exploreModel, QUIETER_WALKING, withRouteNumbers } from '../src/services/routing.js';

describe('route numbers in directions', () => {
  it('says "route 32" for a bare number and "the M3" for a lettered one', () => {
    expect(withRouteNumbers('Keep left and take 32 toward Milton Road')).toBe('Keep left and take route 32 toward Milton Road');
    expect(withRouteNumbers('Keep right and take M3 toward Gold Coast')).toBe('Keep right and take the M3 toward Gold Coast');
    expect(withRouteNumbers('Take A1 onto Bruce Highway')).toBe('Take the A1 onto Bruce Highway');
  });

  it('leaves exits, roundabouts and plain directions as they were', () => {
    expect(withRouteNumbers('At roundabout, take exit 2 onto Moggill Road')).toBe('At roundabout, take exit 2 onto Moggill Road');
    expect(withRouteNumbers('Turn left onto Coronation Drive')).toBe('Turn left onto Coronation Drive');
  });
});

describe('Discover’s time bands', () => {
  it('splits the time asked for in thirds, rounded up to five minutes', () => {
    expect(discoverBands(30)).toEqual([10, 20, 30]);
    expect(discoverBands(45)).toEqual([15, 30, 45]);
    expect(discoverBands(10)).toEqual([5, 10]);
    expect(discoverBands(5)).toEqual([5]);
  });
});

describe('round trips that are loops', () => {
  it('measures how much of a line goes back the way it came', () => {
    const out: LngLat[] = [[153, -27.5], [153.01, -27.5], [153.02, -27.5]];
    expect(doubledBackShare([...out, [153.01, -27.5], [153, -27.5]])).toBeCloseTo(0.5);
    expect(doubledBackShare([[153, -27.5], [153.01, -27.5], [153.01, -27.51], [153, -27.5]])).toBe(0);
    expect(doubledBackShare([])).toBe(0);
  });

  it('keeps walks off main roads where it can, and drives on easier roads (P72)', () => {
    expect(exploreModel('foot', null, 0.5)!.priority).toEqual(QUIETER_WALKING);
    expect(JSON.stringify(exploreModel('car', null, 0.5)!.priority)).toContain('TRACK');
  });
});
