import { describe, expect, it } from 'vitest';
import { googleMapsUrl } from '../src/lib/googleMaps';

const to = { name: 'Raby Bay Harbour', description: 'Cleveland', location: [153.27, -27.52] as [number, number] };

describe('googleMapsUrl', () => {
  it('leaves out the start when it is where the phone is, and keeps any other', () => {
    const here = { name: 'Your location', description: '', location: [153.1, -27.4] as [number, number], current: true };
    expect(googleMapsUrl(here, to, 'car')).toBe('https://www.google.com/maps/dir/?api=1&destination=-27.52%2C153.27&travelmode=driving');
    expect(googleMapsUrl(null, to, 'foot')).toBe('https://www.google.com/maps/dir/?api=1&destination=-27.52%2C153.27&travelmode=walking');
    const home = { name: 'Home', description: 'Saved place', location: [153.1, -27.4] as [number, number] };
    expect(googleMapsUrl(home, to, 'car')).toContain('&origin=-27.4%2C153.1&destination=');
  });

  it('goes by the flag, not the name: a place really called “Your location” is still a start', () => {
    const named = { name: 'Your location', description: 'A cafe', location: [153.1, -27.4] as [number, number] };
    expect(googleMapsUrl(named, to, 'car')).toContain('&origin=-27.4%2C153.1');
  });
});
