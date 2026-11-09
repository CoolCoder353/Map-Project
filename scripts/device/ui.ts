/** Reading the phone's screen from `uiautomator dump`. */
export interface UiNode {
  text: string;
  desc: string;
  id: string;
  pkg: string;
  bounds: [number, number, number, number];
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : '';
};

export function parseUiDump(xml: string): UiNode[] {
  const out: UiNode[] = [];
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
    if (!b) continue;
    out.push({ text: attr(tag, 'text'), desc: attr(tag, 'content-desc'), id: attr(tag, 'resource-id'), pkg: attr(tag, 'package'), bounds: [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])] });
  }
  return out;
}

export const label = (n: UiNode) => n.text || n.desc;
export const centre = (n: UiNode): [number, number] => [Math.round((n.bounds[0] + n.bounds[2]) / 2), Math.round((n.bounds[1] + n.bounds[3]) / 2)];
const inside = (n: UiNode, x: number, y: number) => x >= n.bounds[0] && x < n.bounds[2] && y >= n.bounds[1] && y < n.bounds[3];
const contains = (o: UiNode, n: UiNode) => o.bounds[0] <= n.bounds[0] && o.bounds[1] <= n.bounds[1] && o.bounds[2] >= n.bounds[2] && o.bounds[3] >= n.bounds[3];
/** Drop matches inside another match (a button's own label), keeping the first of identical ones. */
const outermost = (ns: UiNode[]) => ns.filter((n, i) => !ns.some((o, j) => j !== i && contains(o, n) && (!contains(n, o) || j < i)));

/** The screen's size, from the root node. */
export const screenSize = (nodes: UiNode[]): [number, number] => [nodes[0]?.bounds[2] ?? 1080, nodes[0]?.bounds[3] ?? 2400];

/** Lines for `pnpm device ui`: each labelled thing on screen, its id, and where to tap it. */
export function describeScreen(nodes: UiNode[]): string[] {
  return nodes
    .filter((n) => label(n))
    .map((n) => {
      const [x, y] = centre(n);
      return `${JSON.stringify(label(n))}${n.id ? ` #${n.id.replace(/^.*:id\//, '')}` : ''} @ ${x},${y}`;
    });
}

/** The one thing showing this text (exactly, else ignoring case). Throws if there's none, or several. */
export function findByText(nodes: UiNode[], text: string): UiNode {
  const exact = nodes.filter((n) => label(n) === text);
  const matches = outermost(exact.length ? exact : nodes.filter((n) => label(n).toLowerCase() === text.toLowerCase()));
  if (matches.length === 0) throw new Error(`Nothing on screen says "${text}". pnpm device ui lists what does.`);
  if (matches.length > 1) throw new Error(`"${text}" appears ${matches.length} times; tap one by position: ${matches.map((n) => centre(n).join(',')).join('  ')}`);
  return matches[0]!;
}

/** Controls the harness never taps: signing out is `pnpm device down`'s job, and nothing deletes an account. */
export const NEVER_TAP = ['Sign out', 'Delete account', 'Delete my account'];

export function forbiddenAt(nodes: UiNode[], x: number, y: number): string | null {
  const hit = nodes.find((n) => NEVER_TAP.includes(label(n)) && inside(n, x, y));
  return hit ? label(hit) : null;
}

/** Wayfinder's sign-in screen: a password to fill in and a Sign in button. */
export const isSignInScreen = (nodes: UiNode[]) => nodes.some((n) => label(n) === 'Password') && nodes.some((n) => label(n) === 'Sign in');

/** Who is signed in, from Settings' "sam@example.com · Wayfinder at maps.example.com" line. */
export function signedInEmail(nodes: UiNode[]): string | null {
  for (const n of nodes) {
    const m = /^(\S+@\S+) · /.exec(n.text);
    if (m) return m[1]!;
  }
  return null;
}
