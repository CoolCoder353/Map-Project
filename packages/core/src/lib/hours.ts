import OpeningHours from 'opening_hours';
import { type PlaceHours, stateTimeZone } from '@wayfinder/shared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parsed = new Map<string, OpeningHours | null>();

function parse(spec: string): OpeningHours | null {
  if (parsed.has(spec)) return parsed.get(spec)!;
  let oh: OpeningHours | null;
  try {
    // Public holidays ("PH") need a country; without Australian holiday data the library throws,
    // and such specs are simply not shown.
    oh = new OpeningHours(spec, { lat: -33.87, lon: 151.21, address: { country_code: 'au', state: '' } }, 0);
  } catch {
    oh = null;
  }
  if (parsed.size > 5000) parsed.clear();
  parsed.set(spec, oh);
  return oh;
}

/**
 * The library evaluates in the process's local time, so give it a Date whose local fields are
 * the wall-clock time in the place's time zone.
 */
function wallClock(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return new Date(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'am' : 'pm';
  if (h === 0 && m === 0) return 'midnight';
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function when(next: Date, local: Date): string {
  const sameDay = next.toDateString() === local.toDateString();
  const midnightTonight = next.getHours() === 0 && next.getMinutes() === 0 && next.getTime() - local.getTime() < 24 * 3600_000;
  if (sameDay || midnightTonight) return clock(next);
  return `${DAYS[next.getDay()]} ${clock(next)}`;
}

/** "Open until 9 pm", "Closed · opens 7 am", "Open 24 hours", or null when unknown/unparseable. */
export function placeHours(spec: string | null | undefined, state: string | null | undefined, now = new Date()): PlaceHours | null {
  if (!spec) return null;
  const oh = parse(spec);
  if (!oh) return null;
  try {
    const local = wallClock(now, stateTimeZone(state));
    if (oh.getUnknown(local)) return null;
    const open = oh.getState(local);
    const week = new Date(local.getTime() + 8 * 24 * 3600_000);
    const next = oh.getNextChange(local, week);
    if (open) return { openNow: true, label: next ? `Open until ${when(next, local)}` : 'Open 24 hours' };
    return next ? { openNow: false, label: `Closed · opens ${when(next, local)}` } : null;
  } catch {
    return null;
  }
}
