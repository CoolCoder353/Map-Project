import { formatDuration } from '@wayfinder/nav';

export { formatDistanceShort, formatDuration } from '@wayfinder/nav';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const formatNumber = (n: number) => n.toLocaleString('en-AU');
/** A time of day as Australians write it: "3:42 pm". */
export const formatClock = (ms: number) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

/** How long a recorded trip took, in seconds. */
export const tripSeconds = (t: { startedAt: string; endedAt: string }) => Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000);

/** "30 min · 36 km/h average"; just the time for a trip too short to average. */
export function formatTripPace(t: { startedAt: string; endedAt: string; distanceM: number }) {
  const s = tripSeconds(t);
  return s >= 60 ? `${formatDuration(s)} · ${Math.round(t.distanceM / 1000 / (s / 3600))} km/h average` : formatDuration(s);
}
