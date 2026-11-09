import { describe, expect, it } from 'vitest';
import { buildStyle, DRIVING_HIDDEN, POI_SHOWN } from '../../src/style.js';

const layer = (theme: 'light' | 'dark', id: string) => (buildStyle('https://maps.example.test', theme).layers as Array<Record<string, unknown>>).find((l) => l.id === id)!;

describe('map style', () => {
  it('leaves bus stops off and shows a place dot only where its name shows too', () => {
    for (const id of ['poi', 'poi-label']) expect(layer('light', id).filter).toEqual(POI_SHOWN);
    expect(JSON.stringify(POI_SHOWN)).toContain('bus_stop');
    expect(layer('light', 'poi').minzoom).toBe(layer('light', 'poi-label').minzoom);
  });

  it('draws street names at night light enough to read on a dark map', () => {
    const paint = layer('dark', 'road-label').paint as Record<string, string>;
    expect(paint['text-color']).toBe('#ece6da');
  });

  it('leaves buildings, place dots and light markers off the map for driving', () => {
    const ids = (driving: boolean) => (buildStyle('https://maps.example.test', 'light', { driving }).layers as Array<{ id: string }>).map((l) => l.id);
    for (const id of DRIVING_HIDDEN) {
      expect(ids(false)).toContain(id);
      expect(ids(true)).not.toContain(id);
    }
    expect(ids(true)).toContain('road-label');
  });
});
