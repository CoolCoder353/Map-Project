import { type PoiCategory, poiKind } from '@wayfinder/shared/schemas';

/** Discover's category chips. */
export const CATEGORY_LABEL: Record<PoiCategory, string> = {
  viewpoint: 'Lookouts', peak: 'Peaks', waterfall: 'Waterfalls', park: 'Parks', beach: 'Beaches', attraction: 'Attractions',
  cafe: 'Cafés', historic: 'Historic', trailhead: 'Trailheads', museum: 'Museums', picnic: 'Picnic spots',
};

/** One of a kind, e.g. "Lookout" (shared with the web). */
export const kindOf = poiKind;
