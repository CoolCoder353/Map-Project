import { describe, expect, it } from 'vitest';
import { announcementText, exploreTitles, formatDistanceShort, formatDuration, formatSpokenDistance, VIA_MIN_M, viaRoad } from '../src/phrasing.js';

describe('phrasing', () => {
  it('formats spoken distances', () => {
    expect(formatSpokenDistance(812)).toBe('800 metres');
    expect(formatSpokenDistance(47)).toBe('50 metres');
    expect(formatSpokenDistance(1000)).toBe('1 kilometre');
    expect(formatSpokenDistance(1540)).toBe('1.5 kilometres');
  });
  it('formats short distances and durations', () => {
    expect(formatDistanceShort(1234)).toBe('1.2 km');
    expect(formatDistanceShort(87)).toBe('87 m');
    expect(formatDuration(3600 + 25 * 60)).toBe('1 h 25 min');
    expect(formatDuration(59)).toBe('1 min');
  });
  it('builds announcements', () => {
    const ins = { sign: 2, text: 'Turn right onto Main St', streetName: 'Main St', distanceM: 1, durationS: 1, interval: [0, 1] as [number, number] };
    expect(announcementText(ins, 200)).toBe('In 200 metres, turn right onto Main St');
    expect(announcementText(ins, null)).toBe('Turn right onto Main St');
    expect(announcementText({ ...ins, sign: 4 }, null)).toBe('You have arrived at your destination');
  });
});

describe('naming explore routes by where they go', () => {
  const ins = (streetName: string, distanceM: number) => ({ streetName, distanceM });
  const fastest = { instructions: [ins('Moggill Road', 4000), ins('Western Freeway', 6000)] };

  it('names the road the route drives furthest on that the fastest route never uses', () => {
    expect(viaRoad({ instructions: [ins('Moggill Road', 1000), ins('Mount Coot-tha Road', 3000), ins('Sir Samuel Griffith Drive', 5000)] }, fastest)).toBe('Sir Samuel Griffith Drive');
  });

  it('names nothing when every road is shared, unnamed, or too short a stretch', () => {
    expect(viaRoad({ instructions: [ins('Moggill Road', 9000), ins('', 4000), ins('Short Lane', VIA_MIN_M - 1)] }, fastest)).toBeNull();
  });

  it('titles each route by its road, and numbers two that would read the same', () => {
    const a = { instructions: [ins('Bowman Parade', 2000)] };
    const b = { instructions: [ins('Bowman Parade', 3000)] };
    const c = { instructions: [ins('Jubilee Terrace', 2500)] };
    expect(exploreTitles([a, b, c], fastest)).toEqual(['Explore 1', 'Explore 2', 'Via Jubilee Terrace']);
    expect(exploreTitles([{ instructions: [] }], null)).toEqual(['Explore 1']);
    // Both take Bowman Parade, but one also has a road of its own: named by that (C-U5).
    const d = { instructions: [ins('Bowman Parade', 3000), ins('Waterworks Road', 1500)] };
    expect(exploreTitles([a, d], fastest)).toEqual(['Explore 1', 'Via Waterworks Road']);
  });
});
