import { describe, expect, it } from 'vitest';
import { announcementText, formatDistanceShort, formatDuration, formatSpokenDistance } from '../src/phrasing.js';

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
