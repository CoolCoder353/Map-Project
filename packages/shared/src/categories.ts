/**
 * Everyday words people type for kinds of place, mapped to OSM `key=value` types. A query that
 * is one of these words lists the nearest places of that kind.
 */
const CATEGORY_WORDS: Record<string, readonly string[]> = {
  'amenity=fuel': ['petrol', 'petrol station', 'servo', 'fuel', 'gas station', 'service station'],
  'amenity=charging_station': ['ev charger', 'charging station', 'charger'],
  'shop=supermarket': ['supermarket', 'grocery', 'groceries'],
  'shop=convenience': ['convenience store', 'convenience'],
  'amenity=pharmacy': ['pharmacy', 'chemist'],
  'amenity=cafe': ['cafe', 'café', 'coffee'],
  'amenity=restaurant': ['restaurant'],
  'amenity=fast_food': ['fast food', 'takeaway'],
  'amenity=pub': ['pub'],
  'amenity=bar': ['bar'],
  'shop=bakery': ['bakery'],
  'shop=alcohol': ['bottle shop', 'bottlo', 'liquor'],
  'shop=hardware': ['hardware'],
  'shop=doityourself': ['hardware store'],
  'amenity=atm': ['atm', 'cash'],
  'amenity=bank': ['bank'],
  'amenity=toilets': ['toilets', 'toilet', 'loo'],
  'amenity=hospital': ['hospital'],
  'amenity=clinic': ['clinic', 'medical centre', 'doctor'],
  'amenity=post_office': ['post office'],
  'amenity=parking': ['parking', 'car park'],
  'amenity=library': ['library'],
  'amenity=police': ['police'],
  'amenity=drinking_water': ['water', 'drinking water'],
  'tourism=camp_site': ['campsite', 'camp site', 'camping'],
  'tourism=hotel': ['hotel'],
  'tourism=motel': ['motel'],
  'tourism=information': ['visitor centre', 'information centre'],
  'shop=car_repair': ['mechanic'],
};

const WORD_TO_TYPES = new Map<string, string[]>();
for (const [type, words] of Object.entries(CATEGORY_WORDS)) {
  for (const w of words) WORD_TO_TYPES.set(w, [...(WORD_TO_TYPES.get(w) ?? []), type]);
}
// "hardware" also finds DIY stores such as Bunnings.
WORD_TO_TYPES.get('hardware')!.push('shop=doityourself');

const normalise = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** OSM types for a query that names a kind of place ("servo", "pharmacies"), or null. */
export function categoryTypes(q: string): string[] | null {
  const n = normalise(q);
  const hit = WORD_TO_TYPES.get(n) ?? (n.endsWith('ies') ? WORD_TO_TYPES.get(n.slice(0, -3) + 'y') : undefined) ?? (n.endsWith('s') ? WORD_TO_TYPES.get(n.slice(0, -1)) : undefined);
  return hit ? [...new Set(hit)] : null;
}

/** "amenity=fast_food" → "Fast food". */
export function poiTypeLabel(type: string | null | undefined): string {
  const value = type?.split('=')[1];
  if (!value || value === 'yes') return 'Place';
  const words = value.replace(/_/g, ' ');
  return words[0]!.toUpperCase() + words.slice(1);
}
