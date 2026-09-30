import type { PoiCategory } from '@wayfinder/shared/schemas';

/** Discover's category chips. */
export const CATEGORY_LABEL: Record<PoiCategory, string> = {
  viewpoint: 'Lookouts', peak: 'Peaks', waterfall: 'Waterfalls', park: 'Parks', beach: 'Beaches', attraction: 'Attractions',
  cafe: 'Cafés', historic: 'Historic', trailhead: 'Trailheads', museum: 'Museums', picnic: 'Picnic spots',
};

const ONE: Record<PoiCategory, string> = {
  viewpoint: 'Lookout', peak: 'Peak', waterfall: 'Waterfall', park: 'Park', beach: 'Beach', attraction: 'Attraction',
  cafe: 'Café', historic: 'Historic site', trailhead: 'Trailhead', museum: 'Museum', picnic: 'Picnic spot',
};

/** One of a kind, e.g. "Lookout". A newer server may send a category this build doesn't know. */
export const kindOf = (c: string) => ONE[c as PoiCategory] ?? 'Place';
