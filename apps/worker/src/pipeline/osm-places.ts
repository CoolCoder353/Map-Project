import { type PoiCategory, stateAbbreviation } from '@wayfinder/shared';

export interface GeoJsonFeature {
  type: 'Feature';
  id?: string | number;
  properties: Record<string, string | number | undefined>;
  geometry: { type: string; coordinates: unknown } | null;
}

export interface PlaceRecord {
  id: string;
  name: string;
  kind: 'city' | 'town' | 'suburb' | 'street' | 'address' | 'poi';
  category: PoiCategory | null;
  description: string;
  lon: number;
  lat: number;
  importance: number;
  /** Filled from tags here, or from boundaries during import. */
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  /** OSM key=value, e.g. shop=supermarket */
  poiType: string | null;
  brand: string | null;
  openingHours: string | null;
  /** A business's phone and website, as mapped. */
  phone?: string | null;
  website?: string | null;
  /** When someone last checked its details on the ground (OSM check_date), YYYY-MM-DD. */
  checkedOn?: string | null;
  /** addr:city: often the city rather than the suburb, so only a fallback. Not stored. */
  cityTag?: string | null;
}

/** Keys that say what a business or amenity is, most specific first. */
const TYPE_KEYS = ['shop', 'amenity', 'tourism', 'leisure', 'healthcare', 'office', 'craft', 'historic', 'natural', 'waterway', 'highway'];

const PLACE_KIND: Record<string, PlaceRecord['kind']> = {
  city: 'city',
  town: 'town',
  village: 'town',
  hamlet: 'town',
  suburb: 'suburb',
  quarter: 'suburb',
  neighbourhood: 'suburb',
  locality: 'suburb',
};

const STREET_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'pedestrian', 'track', 'path', 'footway', 'cycleway', 'road',
]);

const CATEGORY_LABEL: Record<PoiCategory, string> = {
  viewpoint: 'Lookout',
  peak: 'Peak',
  waterfall: 'Waterfall',
  park: 'Park',
  beach: 'Beach',
  attraction: 'Attraction',
  cafe: 'Café',
  historic: 'Historic site',
  trailhead: 'Trailhead',
  museum: 'Museum',
  picnic: 'Picnic area',
};

export function poiCategory(tags: Record<string, unknown>): PoiCategory | null {
  const t = (k: string) => (typeof tags[k] === 'string' ? (tags[k] as string) : undefined);
  // A bird hide or wader roost is often tagged as a viewpoint too; it isn't a lookout to drive to.
  if (t('tourism') === 'viewpoint') return t('leisure') === 'bird_hide' || /bird ?hide|roost/i.test(t('name') ?? '') ? null : 'viewpoint';
  if (t('natural') === 'peak' || t('natural') === 'volcano') return 'peak';
  if (t('waterway') === 'waterfall' || t('natural') === 'waterfall') return 'waterfall';
  if (t('natural') === 'beach') return 'beach';
  if (t('highway') === 'trailhead') return 'trailhead';
  if (t('tourism') === 'museum') return 'museum';
  if (t('tourism') === 'picnic_site') return 'picnic';
  if (['attraction', 'zoo', 'theme_park', 'aquarium'].includes(t('tourism') ?? '')) return 'attraction';
  if (t('leisure') === 'park' || t('leisure') === 'nature_reserve' || t('boundary') === 'national_park') return 'park';
  if (t('amenity') === 'cafe') return 'cafe';
  if (t('historic') && t('historic') !== 'no') return 'historic';
  return null;
}

/** Representative point: the point itself, a line's middle vertex, or a polygon ring's vertex average. */
export function representativePoint(geometry: GeoJsonFeature['geometry']): [number, number] | null {
  if (!geometry) return null;
  const avg = (ring: number[][]): [number, number] => {
    const n = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.length - 1 : ring.length;
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      x += ring[i]![0]!;
      y += ring[i]![1]!;
    }
    return [x / n, y / n];
  };
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates as [number, number];
    case 'LineString': {
      const c = geometry.coordinates as number[][];
      return c[Math.floor(c.length / 2)] as [number, number];
    }
    case 'MultiLineString': {
      const c = (geometry.coordinates as number[][][])[0]!;
      return c[Math.floor(c.length / 2)] as [number, number];
    }
    case 'Polygon':
      return avg((geometry.coordinates as number[][][])[0]!);
    case 'MultiPolygon':
      return avg((geometry.coordinates as number[][][][])[0]![0]!);
    default:
      return null;
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A business that has closed down but is still mapped: lifecycle tags, or hours that are never open. */
export function closedDown(tags: Record<string, unknown>): boolean {
  const t = (k: string) => (typeof tags[k] === 'string' ? (tags[k] as string).trim().toLowerCase() : undefined);
  if (['yes', 'true'].includes(t('disused') ?? '') || ['yes', 'true'].includes(t('abandoned') ?? '')) return true;
  if (t('demolished') === 'yes' || t('was:shop') || t('was:amenity')) return true;
  const hours = t('opening_hours');
  return hours === 'closed' || hours === 'off';
}

/** A phone number as mapped, or null: the first of several ("a; b"). */
export function phoneOf(tags: Record<string, unknown>): string | null {
  const raw = [tags.phone, tags['contact:phone']].find((v) => typeof v === 'string' && v.trim());
  const first = typeof raw === 'string' ? raw.split(';')[0]!.trim() : '';
  return /^[+\d][\d\s()-]{5,24}$/.test(first) ? first : null;
}

/** A website as mapped, made absolute, or null where it isn't a web address. */
export function websiteOf(tags: Record<string, unknown>): string | null {
  const raw = [tags.website, tags['contact:website'], tags.url].find((v) => typeof v === 'string' && v.trim());
  if (typeof raw !== 'string') return null;
  const first = raw.split(';')[0]!.trim();
  const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The latest date someone checked the place (check_date, or check_date:opening_hours), YYYY-MM-DD. */
export function checkedOnOf(tags: Record<string, unknown>): string | null {
  const dates = [tags.check_date, tags['check_date:opening_hours'], tags['survey:date']]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
  return dates.sort().at(-1) ?? null;
}

/** Map one exported OSM feature to zero or more place records. */
export function featureToPlaces(f: GeoJsonFeature): PlaceRecord[] {
  const tags = f.properties;
  const pt = representativePoint(f.geometry);
  if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return [];
  const [lon, lat] = [round6(pt[0]), round6(pt[1])];
  // Exported with `osmium export --add-unique-id=type_id`, so ids look like "n123" / "w456".
  const id = f.id === undefined ? '' : String(f.id);
  if (!id) return [];
  const str = (k: string) => (typeof tags[k] === 'string' && (tags[k] as string).trim() ? (tags[k] as string).trim() : null);
  const brand = str('brand');
  const typeKey = TYPE_KEYS.find((k) => str(k) && !(k === 'highway' && str(k) !== 'trailhead'));
  const poiType = typeKey ? `${typeKey}=${str(typeKey)}` : null;
  // Brand-only stores ("brand=Woolworths", no name) are still worth finding.
  const name = str('name') ?? (brand && (tags.shop || tags.amenity) ? brand : '');
  const suburb = str('addr:suburb');
  const state = str('addr:state') ? (stateAbbreviation({ iso: str('addr:state')!, name: str('addr:state')! }) ?? null) : null;
  const postcode = str('addr:postcode');
  const base = { suburb, state, postcode, poiType: null, brand: null, openingHours: null, cityTag: str('addr:city') } satisfies Partial<PlaceRecord>;
  const out: PlaceRecord[] = [];

  const placeKind = typeof tags.place === 'string' ? PLACE_KIND[tags.place] : undefined;
  if (placeKind && name) {
    const population = Number(tags.population ?? 0);
    const importanceBase = placeKind === 'city' ? 0.8 : placeKind === 'town' ? 0.5 : 0.2;
    out.push({
      ...base,
      // A settlement is its own suburb (used to share postcodes with its addresses).
      suburb: name,
      id,
      name,
      kind: placeKind,
      category: null,
      description: tags.place === 'locality' ? 'Locality' : String(tags.place).replace(/^\w/, (c) => c.toUpperCase()),
      lon,
      lat,
      importance: Math.min(1, importanceBase + (population > 0 ? Math.log10(population) / 20 : 0)),
    });
    return out;
  }

  const poi = { ...base, poiType, brand, openingHours: str('opening_hours'), phone: phoneOf(tags), website: websiteOf(tags), checkedOn: checkedOnOf(tags) };
  // An address on a named place (a school, a shop) is recorded separately, so the place keeps its
  // name and the address is still searchable. Without this the place is lost: 22% of named places
  // in Queensland carry addr:housenumber.
  const houseNumber = str('addr:housenumber');
  const addrStreet = str('addr:street');
  const address = (suffix = ''): PlaceRecord[] =>
    houseNumber && addrStreet
      ? [
          {
            ...base,
            id: `${id}${suffix}`,
            name: `${houseNumber} ${addrStreet}`,
            kind: 'address',
            category: null,
            description: [suburb ?? base.cityTag, postcode].filter(Boolean).join(' '),
            lon,
            lat,
            importance: 0,
          },
        ]
      : [];

  // A business that has closed is left out; its address is still worth finding.
  const closed = closedDown(tags);
  const category = poiCategory(tags);
  if (category && name && !closed) {
    out.push({ ...poi, id, name, kind: 'poi', category, description: [CATEGORY_LABEL[category], suburb ?? base.cityTag].filter(Boolean).join(', '), lon, lat, importance: 0.1 });
    return [...out, ...address(':addr')];
  }

  if (typeof tags.highway === 'string' && STREET_HIGHWAYS.has(tags.highway) && name && f.geometry?.type !== 'Point') {
    // The road class decides whether a street can serve as a route via point (dead ends can't).
    out.push({ ...base, id, name, kind: 'street', category: null, poiType: `highway=${tags.highway}`, description: suburb ?? base.cityTag ?? '', lon, lat, importance: 0 });
    return out;
  }

  // Other named businesses and amenities: searchable, not suggested by Discover.
  if (name && !closed && (tags.amenity || tags.tourism || tags.shop || tags.leisure || tags.healthcare || tags.office || tags.craft)) {
    out.push({ ...poi, id, name, kind: 'poi', category: null, description: String(tags.amenity ?? tags.tourism ?? tags.shop ?? tags.leisure ?? tags.healthcare ?? tags.office ?? tags.craft).replace(/_/g, ' '), lon, lat, importance: 0.05 });
    return [...out, ...address(':addr')];
  }

  return [...out, ...address()];
}

/**
 * Streets are mapped as many short ways: keep one record per name per suburb, or per ~1 km
 * square where the suburb is unknown.
 */
export function streetKey(p: PlaceRecord): string | null {
  if (p.kind !== 'street') return null;
  if (p.suburb) return `${p.name.toLowerCase()}|${p.suburb.toLowerCase()}|${p.state ?? ''}`;
  return `${p.name.toLowerCase()}|${Math.round(p.lon * 100)}|${Math.round(p.lat * 100)}`;
}

/** osmium tags-filter expressions selecting everything the importer understands. */
export const OSMIUM_FILTERS = [
  'nwr/place',
  'nwr/tourism',
  'nwr/natural=peak,volcano,beach,waterfall',
  'nwr/waterway=waterfall',
  'nwr/leisure=park,nature_reserve',
  'nwr/boundary=national_park',
  'nwr/amenity',
  'nwr/historic',
  'nwr/shop',
  'nwr/brand',
  'nwr/healthcare',
  'nwr/office',
  'nwr/craft',
  'nwr/leisure',
  'w/highway',
  'n/highway=trailhead',
  'nwr/addr:housenumber',
];
