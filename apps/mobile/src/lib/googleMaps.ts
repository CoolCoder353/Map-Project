import type { Mode } from '@wayfinder/shared/schemas';
import type { ChosenPlace } from '../ui/PlaceSearch';

/**
 * Hands the trip to Google Maps (its app where installed, else the website): the destination, the
 * start unless it's where you are (Google Maps starts there anyway), and walking or driving.
 */
export function googleMapsUrl(from: ChosenPlace | null, to: ChosenPlace, mode: Mode): string {
  // By hand: React Native's URLSearchParams can't set values.
  const at = (p: ChosenPlace) => encodeURIComponent(`${p.location[1]},${p.location[0]}`);
  const origin = from && from.name !== 'Your location' ? `&origin=${at(from)}` : '';
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${at(to)}&travelmode=${mode === 'foot' ? 'walking' : 'driving'}`;
}
