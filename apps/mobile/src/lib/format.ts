import { formatDuration } from '@wayfinder/nav';

export { exploreTitles, formatDistanceShort, formatDuration } from '@wayfinder/nav';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const formatNumber = (n: number) => n.toLocaleString('en-AU');
/** A time of day as Australians write it: "3:42 pm". */
export const formatClock = (ms: number) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

/**
 * When a trip started and finished, "10 Nov, 9:48 am–9:56 am"; one time for a trip that ended in
 * the minute it started, rather than "9:51 am–9:51 am" (R2-P6).
 */
export function tripWhen(t: { startedAt: string; endedAt: string }, dash = '–'): string {
  const start = formatDateTime(t.startedAt);
  const end = formatClock(Date.parse(t.endedAt));
  return formatClock(Date.parse(t.startedAt)) === end ? start : `${start}${dash}${end}`;
}

/** Where a trip went: where its directions led, else the place nearest where it ended (R2-P5). */
export const tripTo = (t: { destinationName?: string | null; endedNear?: string | null }) => t.destinationName || t.endedNear || null;

/** How long a recorded trip took, in seconds. */
export const tripSeconds = (t: { startedAt: string; endedAt: string }) => Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000);

/** "30 min · 36 km/h average"; just the time for a trip too short to average. */
export function formatTripPace(t: { startedAt: string; endedAt: string; distanceM: number }) {
  const s = tripSeconds(t);
  return s >= 60 ? `${formatDuration(s)} · ${Math.round(t.distanceM / 1000 / (s / 3600))} km/h average` : formatDuration(s);
}
