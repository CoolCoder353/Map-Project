import type { Voice } from './schemas/app.js';

const km = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} km`;

/**
 * User-facing copy that changes with the admin-selected voice. Controls, errors and admin
 * screens stay plain everywhere; only framing, empty states and prompts vary.
 */
export interface CopyCatalog {
  tagline: string;
  signInTitle: (appName: string) => string;
  registerIntro: string;
  searchPlaceholder: string;
  newKm: (n: number) => string;
  allNewAlready: string;
  exploreHeading: string;
  budgetLabel: (minutes: number) => string;
  roundTripIntro: string;
  noRoundTrips: string;
  discoverIntro: string;
  discoverEmpty: string;
  coverageIntro: string;
  coverageEmpty: string;
  tripsEmpty: string;
  trackingOffHint: string;
  sentToPhone: string;
}

const plain: CopyCatalog = {
  tagline: 'Maps that remember where you’ve been.',
  signInTitle: (name) => `Sign in to ${name}`,
  registerIntro: 'You’ll need the invite code a friend sent you.',
  searchPlaceholder: 'Search places and addresses',
  newKm: (n) => `${km(n)} you’ve never been`,
  allNewAlready: 'You haven’t been along any of the fastest route yet, so it already explores somewhere new.',
  exploreHeading: 'Ways you haven’t been',
  budgetLabel: (m) => `Up to ${m} min extra`,
  roundTripIntro: 'A loop from where you start, leaning towards places you haven’t been.',
  noRoundTrips: 'Couldn’t make a loop that length from here. Try a different time or starting point.',
  discoverIntro: 'Places within reach, in areas you haven’t explored.',
  discoverEmpty: 'Nothing new within reach. Try a longer time or another category.',
  coverageIntro: 'Every road and path you’ve travelled.',
  coverageEmpty: 'Nothing recorded yet. Turn on tracking in the Android app, or navigate a route, and your roads start filling in.',
  tripsEmpty: 'No trips yet. Trips appear here after the Android app records them.',
  trackingOffHint: 'Background tracking is off. You can turn it on in the Android app.',
  sentToPhone: 'Saved. Open Planned routes on your phone to start.',
};

const playful: CopyCatalog = {
  tagline: 'Here be dragons, until you go and look.',
  signInTitle: (name) => `Welcome back to ${name}`,
  registerIntro: 'Got an invite code from a fellow explorer? Pop it in below.',
  searchPlaceholder: 'Where to, explorer?',
  newKm: (n) => `${km(n)} of uncharted ground`,
  allNewAlready: 'Every bit of the fastest route is uncharted for you, so it’s already an adventure.',
  exploreHeading: 'Off the beaten track',
  budgetLabel: (m) => `Detour budget: ${m} min`,
  roundTripIntro: 'Start here, wander somewhere new, end up back where you began.',
  noRoundTrips: 'The map couldn’t loop that one. Nudge the time or the start and try again.',
  discoverIntro: 'Uncharted spots within reach.',
  discoverEmpty: 'The nearby map is well explored. Widen your range to find new frontiers.',
  coverageIntro: 'Your explored world, one road at a time.',
  coverageEmpty: 'No roads travelled yet. Switch on tracking in the Android app and start filling the map in.',
  tripsEmpty: 'No expeditions logged yet. The Android app records them as you go.',
  trackingOffHint: 'Tracking’s off, so no new roads are being logged. Switch it on in the Android app.',
  sentToPhone: 'Packed and ready. Find it under Planned routes on your phone.',
};

const minimal: CopyCatalog = {
  tagline: 'Routes ranked by new ground.',
  signInTitle: (name) => name,
  registerIntro: 'Invite code required.',
  searchPlaceholder: 'Search',
  newKm: (n) => `${km(n)} new`,
  allNewAlready: 'Fastest route is entirely new.',
  exploreHeading: 'Explore',
  budgetLabel: (m) => `+${m} min max`,
  roundTripIntro: 'Loop from start point.',
  noRoundTrips: 'No loop found.',
  discoverIntro: 'Unvisited places in range.',
  discoverEmpty: 'No results.',
  coverageIntro: 'Roads travelled.',
  coverageEmpty: 'No coverage recorded.',
  tripsEmpty: 'No trips.',
  trackingOffHint: 'Tracking off.',
  sentToPhone: 'Saved to planned routes.',
};

export const COPY: Record<Voice, CopyCatalog> = { plain, playful, minimal };

export const copyFor = (voice: Voice): CopyCatalog => COPY[voice] ?? plain;
