import { describe, expect, it } from 'vitest';
import { centre, describeScreen, findByText, forbiddenAt, isSignInScreen, parseUiDump, screenSize, signedInEmail } from '../../device/ui.js';
import { dump, node } from './fakes.js';

describe('reading the screen', () => {
  const nodes = parseUiDump(
    dump(
      node({ text: 'sam@example.test · Wayfinder at maps.example.test', b: [40, 300, 1040, 340] }),
      node({ desc: 'Sign out', b: [40, 2000, 400, 2100] }),
      node({ text: 'Sign out', b: [60, 2020, 380, 2080] }),
      node({ text: 'Remove', b: [800, 900, 1000, 960] }),
      node({ text: 'Remove', b: [800, 1100, 1000, 1160] }),
      node({ text: 'Tom &amp; Jerry&apos;s', id: 'app.wayfinder.maps:id/place', b: [0, 500, 1080, 600] }),
    ),
  );

  it('parses each node, with its text decoded', () => {
    expect(nodes).toHaveLength(7);
    expect(nodes[6]).toMatchObject({ text: "Tom & Jerry's", id: 'app.wayfinder.maps:id/place', bounds: [0, 500, 1080, 600] });
    expect(screenSize(nodes)).toEqual([1080, 2400]);
  });

  it('lists what can be tapped, and where', () => {
    expect(describeScreen(nodes)).toContain('"Tom & Jerry\'s" #place @ 540,550');
  });

  it('finds the one thing showing a text, taking a button over the label inside it', () => {
    expect(centre(findByText(nodes, 'sign out'))).toEqual([220, 2050]);
    expect(() => findByText(nodes, 'Remove')).toThrow('appears 2 times');
    expect(() => findByText(nodes, 'Nowhere')).toThrow('Nothing on screen says "Nowhere"');
  });

  it('knows what it must never tap', () => {
    expect(forbiddenAt(nodes, 220, 2050)).toBe('Sign out');
    expect(forbiddenAt(nodes, 900, 930)).toBeNull();
  });

  it('reads who is signed in on Settings, and recognises the sign-in screen', () => {
    expect(signedInEmail(nodes)).toBe('sam@example.test');
    expect(isSignInScreen(nodes)).toBe(false);
    const signIn = parseUiDump(dump(node({ text: 'Email', b: [0, 0, 10, 10] }), node({ text: 'Password', b: [0, 20, 10, 30] }), node({ text: 'Sign in', b: [0, 40, 10, 50] })));
    expect(isSignInScreen(signIn)).toBe(true);
    expect(signedInEmail(signIn)).toBeNull();
  });
});
