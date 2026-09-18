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

/** OSM values whose plain spelling reads oddly in Australia. */
const TYPE_LABELS: Record<string, string> = {
  fuel: 'Petrol station',
  doityourself: 'Hardware store',
  charging_station: 'EV charger',
  alcohol: 'Bottle shop',
  convenience: 'Convenience store',
  car_repair: 'Mechanic',
  atm: 'ATM',
  bbq: 'Barbecue',
  fast_food: 'Takeaway',
  toilets: 'Toilets',
  pitch: 'Sports field',
  camp_site: 'Campsite',
};

/** "shop=supermarket" → "Supermarket", "amenity=fuel" → "Petrol station". */
export function poiTypeLabel(type: string | null | undefined): string {
  const value = type?.split('=')[1];
  if (!value || value === 'yes') return 'Place';
  if (TYPE_LABELS[value]) return TYPE_LABELS[value];
  const words = value.replace(/_/g, ' ');
  return words[0]!.toUpperCase() + words.slice(1);
}

const STREET_WORDS: Record<string, string> = {
  st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive', pde: 'parade', cres: 'crescent', cr: 'crescent',
  pl: 'place', hwy: 'highway', ct: 'court', tce: 'terrace', cct: 'circuit', cl: 'close', gr: 'grove', ln: 'lane',
  blvd: 'boulevard', esp: 'esplanade', sq: 'square', pt: 'point', mt: 'mount', nth: 'north', sth: 'south',
};

/**
 * Spell out the abbreviations people type in addresses ("12 Lonsdale St" → "12 Lonsdale street").
 * A leading "St" stays as it is: at the start it usually means Saint ("St Kilda").
 */
export function expandAbbreviations(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const key = word.toLowerCase().replace(/\.$/, '');
      if (i === 0 && key === 'st') return word;
      return STREET_WORDS[key] ?? word;
    })
    .join(' ');
}
