/** Australian states and territories: abbreviations and the time zone their places keep. */
export const AU_STATES = {
  NSW: { name: 'New South Wales', timeZone: 'Australia/Sydney' },
  VIC: { name: 'Victoria', timeZone: 'Australia/Melbourne' },
  QLD: { name: 'Queensland', timeZone: 'Australia/Brisbane' },
  SA: { name: 'South Australia', timeZone: 'Australia/Adelaide' },
  WA: { name: 'Western Australia', timeZone: 'Australia/Perth' },
  TAS: { name: 'Tasmania', timeZone: 'Australia/Hobart' },
  NT: { name: 'Northern Territory', timeZone: 'Australia/Darwin' },
  ACT: { name: 'Australian Capital Territory', timeZone: 'Australia/Sydney' },
  JBT: { name: 'Jervis Bay Territory', timeZone: 'Australia/Sydney' },
} as const;
export type AuState = keyof typeof AU_STATES;

const BY_NAME = new Map(Object.entries(AU_STATES).map(([abbr, s]) => [s.name.toLowerCase(), abbr as AuState]));

/** State abbreviation from an OSM boundary's ISO 3166-2 code ("AU-NSW") or name. */
export function stateAbbreviation(tags: { iso?: string | undefined; name?: string | undefined }): AuState | null {
  const iso = tags.iso?.toUpperCase().replace(/^AU-/, '');
  if (iso && iso in AU_STATES) return iso as AuState;
  return (tags.name && BY_NAME.get(tags.name.toLowerCase())) || null;
}

export const stateTimeZone = (state: string | null | undefined): string =>
  (state && state in AU_STATES ? AU_STATES[state as AuState].timeZone : 'Australia/Sydney');

/**
 * Where a place is, for a search suggestion: "Dickson ACT 2602" for things inside a suburb,
 * "NSW 2620" for a suburb or town itself.
 */
export function placeContext(p: { kind: string; suburb?: string | null; state?: string | null; postcode?: string | null; name: string }): string {
  const settlement = p.kind === 'city' || p.kind === 'town' || p.kind === 'suburb';
  const suburb = settlement || !p.suburb || p.suburb === p.name ? null : p.suburb;
  return [suburb, p.state, settlement && p.kind === 'city' ? null : p.postcode].filter(Boolean).join(' ');
}

/**
 * The line under a search suggestion: "Supermarket · Dickson ACT 2602 · 1.5 km". Falls back to
 * the plain description for places imported before context existed.
 */
export function placeDetail(
  p: { description: string; typeLabel?: string | undefined; context?: string | undefined; distanceM?: number | undefined },
  formatDistance: (m: number) => string,
): string {
  const parts = p.typeLabel || p.context ? [p.typeLabel, p.context] : [p.description];
  if (p.distanceM !== undefined) parts.push(formatDistance(p.distanceM));
  return parts.filter(Boolean).join(' · ');
}

/**
 * The time zone at a point in Australia, roughly: Western Australia west of 129°E, the Northern
 * Territory and South Australia either side of 26°S as far as 138°E and 141°E, Queensland north of
 * its border with New South Wales (which runs near 29°S inland and 28.2°S on the coast), and the
 * eastern states' zone elsewhere. Good enough to know what hour of the day it is on a road, which is
 * what it's for; a town right on a border (Broken Hill keeps Adelaide time) can be an hour out.
 */
export function timeZoneAt([lon, lat]: readonly [number, number]): string {
  if (lon < 129) return AU_STATES.WA.timeZone;
  if (lon < 138) return lat > -26 ? AU_STATES.NT.timeZone : AU_STATES.SA.timeZone;
  if (lon < 141) return lat > -26 ? AU_STATES.QLD.timeZone : AU_STATES.SA.timeZone;
  if (lat < -39.2) return AU_STATES.TAS.timeZone;
  return lat > (lon >= 151 ? -28.2 : -29) ? AU_STATES.QLD.timeZone : AU_STATES.NSW.timeZone;
}

/** The weekday (0 Sunday) and hour (0–23) on the wall clock in a time zone. */
export function localDayHour(at: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) };
}

/** A time zone's wall clock minus UTC at a moment, in seconds (36 000 in Brisbane). */
export function utcOffsetS(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 1000);
}
