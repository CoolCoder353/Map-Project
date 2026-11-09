import type { Instruction } from '@wayfinder/shared/schemas';

/** Spoken distance, rounded the way people say it. */
export function formatSpokenDistance(m: number): string {
  if (m >= 950) {
    const km = Math.round(m / 100) / 10;
    return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} kilometre${km === 1 ? '' : 's'}`;
  }
  const rounded = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
  return `${rounded} metres`;
}

/** Short on-screen distance, e.g. "350 m" or "1.2 km". */
export function formatDistanceShort(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
  return `${m >= 100 ? Math.round(m / 10) * 10 : Math.round(m)} m`;
}

export function formatDuration(s: number): string {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Voice text for an upcoming instruction; distanceM null means "now". */
export function announcementText(ins: Instruction, distanceM: number | null): string {
  const base =
    ins.sign === 4
      ? distanceM === null
        ? 'You have arrived at your destination'
        : 'you will arrive at your destination'
      : ins.sign === 5
        ? distanceM === null
          ? 'You have reached a waypoint'
          : 'you will reach a waypoint'
        : ins.text || 'Continue';
  if (distanceM === null) return base[0]!.toUpperCase() + base.slice(1);
  return `In ${formatSpokenDistance(distanceM)}, ${lowerFirst(base)}`;
}

/** A road has to carry at least this much of a route, not on the fastest one, to name it. */
export const VIA_MIN_M = 500;

/**
 * The road that sets [route] apart from [fastest]: the one it drives furthest on that the fastest
 * route doesn't use at all. Null when there's none worth naming (unnamed tracks, or every road is
 * shared). Names a route by where it goes, rather than "Explore 2".
 */
export function viaRoad(route: { instructions: readonly Pick<Instruction, 'streetName' | 'distanceM'>[] }, fastest: { instructions: readonly Pick<Instruction, 'streetName'>[] } | null): string | null {
  const onFastest = new Set((fastest?.instructions ?? []).map((i) => i.streetName.trim().toLowerCase()).filter(Boolean));
  const along = new Map<string, number>();
  for (const i of route.instructions) {
    const name = i.streetName.trim();
    if (!name || onFastest.has(name.toLowerCase())) continue;
    along.set(name, (along.get(name) ?? 0) + i.distanceM);
  }
  let best: [string, number] | null = null;
  for (const e of along) if (e[1] >= VIA_MIN_M && (!best || e[1] > best[1])) best = e;
  return best?.[0] ?? null;
}

/**
 * Titles for explore routes: "Via Moggill Road" where a road sets each apart, else "Explore 2".
 * Two routes that would share a title both keep their numbers, so no two read the same.
 */
export function exploreTitles(explore: readonly { instructions: readonly Pick<Instruction, 'streetName' | 'distanceM'>[] }[], fastest: { instructions: readonly Pick<Instruction, 'streetName'>[] } | null): string[] {
  const vias = explore.map((r) => viaRoad(r, fastest));
  return vias.map((v, i) => (v && vias.filter((o) => o === v).length === 1 ? `Via ${v}` : `Explore ${i + 1}`));
}
