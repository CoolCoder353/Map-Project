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
