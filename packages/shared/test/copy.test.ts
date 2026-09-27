import { describe, expect, it } from 'vitest';
import { COPY, type CopyCatalog, copyFor } from '../src/copy.js';

const VOICES = ['plain', 'playful', 'minimal'] as const;

/** Every string a voice can produce, with sample arguments. */
function allText(c: CopyCatalog): string[] {
  return [
    ...Object.values(c).filter((v): v is string => typeof v === 'string'),
    c.signInTitle('Wayfinder'),
    c.newKm(4.2),
    c.newKm(12),
    c.budgetLabel(15),
  ];
}

describe('voice copy', () => {
  it('has every entry, non-empty, in every voice', () => {
    const keys = Object.keys(COPY.plain).sort();
    for (const voice of VOICES) {
      expect(Object.keys(COPY[voice]).sort()).toEqual(keys);
      for (const text of allText(COPY[voice])) expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('never names hexagons, cells or fog: coverage is roads travelled', () => {
    for (const voice of VOICES) for (const text of allText(COPY[voice])) expect(text).not.toMatch(/hexagon|\bhex\b|\bcells?\b|fog/i);
  });

  it('formats new kilometres with one decimal under ten', () => {
    expect(COPY.plain.newKm(4.24)).toBe('4.2 km you’ve never been');
    expect(COPY.plain.newKm(12.6)).toBe('13 km you’ve never been');
    expect(COPY.playful.newKm(0.5)).toBe('0.5 km of uncharted ground');
    expect(COPY.minimal.newKm(10)).toBe('10 km new');
  });

  it('puts the app name and budget where they belong', () => {
    expect(COPY.plain.signInTitle('Roamer')).toBe('Sign in to Roamer');
    expect(COPY.minimal.signInTitle('Roamer')).toBe('Roamer');
    expect(COPY.plain.budgetLabel(20)).toBe('Up to 20 min extra');
    expect(COPY.playful.budgetLabel(20)).toBe('Detour budget: 20 min');
    expect(COPY.minimal.budgetLabel(20)).toBe('+20 min max');
  });

  it('falls back to plain for an unknown voice', () => {
    expect(copyFor('playful')).toBe(COPY.playful);
    expect(copyFor('shouty' as never)).toBe(COPY.plain);
  });
});
