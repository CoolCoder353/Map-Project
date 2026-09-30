import { POI_CATEGORIES } from '@wayfinder/shared/schemas';
import { expect, it } from 'vitest';
import { CATEGORY_LABEL, kindOf } from '../src/lib/categories';

it('names one of each kind properly', () => {
  expect(kindOf('beach')).toBe('Beach');
  expect(kindOf('viewpoint')).toBe('Lookout');
  expect(kindOf('cafe')).toBe('Café');
  expect(kindOf('picnic')).toBe('Picnic spot');
  expect(kindOf('historic')).toBe('Historic site');
});

it('has a name for every category, and copes with one from a newer server', () => {
  for (const c of POI_CATEGORIES) expect(CATEGORY_LABEL[c]).toBeTruthy();
  expect(kindOf('spaceport')).toBe('Place');
});
