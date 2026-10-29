import { describe, expect, it } from 'vitest';
import { newInviteCode } from '../src/lib/tokens.js';

describe('invite codes', () => {
  it('are 12 random characters from a 32-letter alphabet (60 bits), in groups of four', () => {
    const codes = Array.from({ length: 200 }, newInviteCode);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(new Set(codes).size).toBe(codes.length);
    // Every letter of the alphabet turns up, so none is stuck or skipped.
    expect(new Set(codes.join('').replaceAll('-', '')).size).toBe(32);
  });
});
