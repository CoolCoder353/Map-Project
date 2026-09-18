import { describe, expect, it } from 'vitest';
import { placeHours } from '../src/lib/hours.js';

// 2026-09-18 is a Friday. 02:30 UTC is 12:30 pm in Sydney (AEST) and 10:30 am in Perth.
const fridayNoonSydney = new Date('2026-09-18T02:30:00Z');

describe('opening hours', () => {
  it('says when an open place closes, in the place’s own time zone', () => {
    expect(placeHours('Mo-Su 07:00-22:00', 'ACT', fridayNoonSydney)).toEqual({ openNow: true, label: 'Open until 10 pm' });
    expect(placeHours('Mo-Fr 09:00-17:30', 'NSW', fridayNoonSydney)).toEqual({ openNow: true, label: 'Open until 5:30 pm' });
  });

  it('gives the same shop different answers in Perth and Sydney at the same instant', () => {
    expect(placeHours('Mo-Su 11:00-21:00', 'NSW', fridayNoonSydney)?.openNow).toBe(true);
    expect(placeHours('Mo-Su 11:00-21:00', 'WA', fridayNoonSydney)).toEqual({ openNow: false, label: 'Closed · opens 11 am' });
  });

  it('names the day when the next opening is not today', () => {
    expect(placeHours('Mo-Th 08:00-16:00', 'VIC', fridayNoonSydney)).toEqual({ openNow: false, label: 'Closed · opens Mon 8 am' });
  });

  it('handles 24/7, midnight closes, and unusable specs', () => {
    expect(placeHours('24/7', 'QLD', fridayNoonSydney)).toEqual({ openNow: true, label: 'Open 24 hours' });
    expect(placeHours('Mo-Su 10:00-24:00', 'NSW', fridayNoonSydney)).toEqual({ openNow: true, label: 'Open until midnight' });
    expect(placeHours('call us', 'NSW', fridayNoonSydney)).toBeNull();
    expect(placeHours(null, 'NSW', fridayNoonSydney)).toBeNull();
    expect(placeHours('off', 'NSW', fridayNoonSydney)).toBeNull();
  });
});
