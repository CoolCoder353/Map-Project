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
