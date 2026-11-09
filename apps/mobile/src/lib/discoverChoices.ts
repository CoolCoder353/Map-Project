import type { PoiCategory } from '@wayfinder/shared/schemas';

/** What Discover on the phone was last set to: the car's Discover uses the same (C31, C53). */
export interface DiscoverChoices {
  minutes: number;
  categories: PoiCategory[];
}

const DEFAULT: DiscoverChoices = { minutes: 30, categories: [] };
let current: DiscoverChoices = DEFAULT;

export function rememberDiscoverChoices(c: DiscoverChoices) {
  current = { minutes: c.minutes, categories: [...c.categories] };
}

export const discoverChoices = (): DiscoverChoices => current;

/** For tests. */
export const forgetDiscoverChoices = () => {
  current = DEFAULT;
};
