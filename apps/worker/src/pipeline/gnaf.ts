/**
 * Street addresses from G-NAF, the Geocoded National Address File (Geoscape Australia, published
 * quarterly on data.gov.au under an open licence based on CC BY 4.0): every address in Australia
 * with its locality, postcode and a point. OpenStreetMap has addresses for only some buildings, so
 * search uses these as well; where both have an address, this one is kept.
 *
 * It is an outside download agreed for this purpose, like the OpenStreetMap extract: it happens
 * only while map data is being built (the `gnaf` step of a refresh), never while anyone uses the
 * app. The licence forbids using the addresses to send mail, and asks for the credit shown on the
 * privacy page.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { PlaceRecord } from './osm-places.js';

/** The dataset's description, which lists the current release's zip files. */
export const GNAF_DATASET = 'https://data.gov.au/data/api/3/action/package_show?id=geocoded-national-address-file-g-naf';

/** The states and territories G-NAF has files for that the map covers. */
export const GNAF_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;
export type GnafState = (typeof GNAF_STATES)[number];

/** The states named in a GNAF_STATES setting ("QLD, nsw"); all of them when it is empty. */
export function gnafStates(setting: string): GnafState[] {
  const named = setting.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = named.filter((s) => !(GNAF_STATES as readonly string[]).includes(s));
  if (unknown.length) throw new Error(`Unknown state(s): ${unknown.join(', ')}. States: ${GNAF_STATES.join(', ')}`);
  return named.length ? GNAF_STATES.filter((s) => named.includes(s)) : [...GNAF_STATES];
}

/**
 * The current release's zip, from the dataset's description. Each release comes in two datums;
 * GDA2020 is the one that lines up with GPS and OpenStreetMap to within a couple of centimetres.
 */
export function latestRelease(description: unknown): { name: string; url: string } {
  const resources = (description as { result?: { resources?: Array<{ name?: string; url?: string; format?: string }> } })?.result?.resources ?? [];
  const zips = resources.filter((r) => (r.format ?? '').toUpperCase() === 'ZIP' && typeof r.url === 'string' && r.url.startsWith('https://'));
  const zip = zips.find((r) => /gda\s*2020/i.test(`${r.name ?? ''} ${r.url}`));
  if (!zip) throw new Error('The G-NAF dataset lists no GDA2020 zip file');
  return { name: zip.name ?? zip.url!, url: zip.url! };
}

/** The files of one state the importer reads, as named inside the zip. */
export function stateFiles(state: GnafState): string[] {
  return ['ADDRESS_DETAIL', 'ADDRESS_DEFAULT_GEOCODE', 'STREET_LOCALITY', 'LOCALITY'].map((t) => `${state}_${t}_psv.psv`);
}

/** The table of what street suffix codes stand for ("N" is North). */
export const STREET_SUFFIX_FILE = 'Authority_Code_STREET_SUFFIX_AUT_psv.psv';

/** "MOUNT COOT-THA" as "Mount Coot-Tha", "O'CONNELL" as "O'Connell", "MCDONALD" as "McDonald". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/(])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/'S\b/g, "'s")
    .replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`);
}

/**
 * The named columns of a pipe-separated file, row by row. G-NAF files have a header line and no
 * quoting. A file without one of the columns is an error: the layout has changed.
 */
export async function* readPsv(path: string, columns: string[]): AsyncGenerator<string[]> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let index: number[] | null = null;
  for await (const line of rl) {
    if (!line) continue;
    const fields = line.split('|');
    if (!index) {
      const header = fields.map((f) => f.replace(/^\uFEFF/, '').trim().toUpperCase());
      index = columns.map((c) => {
        const i = header.indexOf(c);
        if (i < 0) throw new Error(`${path} has no ${c} column`);
        return i;
      });
      continue;
    }
    yield index.map((i) => fields[i] ?? '');
  }
}

type Rows = AsyncIterable<string[]> | Iterable<string[]>;

export interface GnafTables {
  /** CODE, NAME */
  streetSuffixes: Rows;
  /** LOCALITY_PID, LOCALITY_NAME, PRIMARY_POSTCODE, DATE_RETIRED */
  localities: Rows;
  /** STREET_LOCALITY_PID, STREET_NAME, STREET_TYPE_CODE, STREET_SUFFIX_CODE, LOCALITY_PID, DATE_RETIRED */
  streets: Rows;
  /** See DETAIL_COLUMNS */
  details: Rows;
  /** ADDRESS_DETAIL_PID, LONGITUDE, LATITUDE, DATE_RETIRED */
  geocodes: Rows;
}

export const SUFFIX_COLUMNS = ['CODE', 'NAME'];
export const LOCALITY_COLUMNS = ['LOCALITY_PID', 'LOCALITY_NAME', 'PRIMARY_POSTCODE', 'DATE_RETIRED'];
export const STREET_COLUMNS = ['STREET_LOCALITY_PID', 'STREET_NAME', 'STREET_TYPE_CODE', 'STREET_SUFFIX_CODE', 'LOCALITY_PID', 'DATE_RETIRED'];
export const DETAIL_COLUMNS = [
  'ADDRESS_DETAIL_PID',
  'DATE_RETIRED',
  'FLAT_NUMBER',
  'LEVEL_NUMBER',
  'NUMBER_FIRST_PREFIX',
  'NUMBER_FIRST',
  'NUMBER_FIRST_SUFFIX',
  'STREET_LOCALITY_PID',
  'ALIAS_PRINCIPAL',
  'POSTCODE',
  'CONFIDENCE',
];
export const GEOCODE_COLUMNS = ['ADDRESS_DETAIL_PID', 'LONGITUDE', 'LATITUDE', 'DATE_RETIRED'];

interface Kept {
  pid: string;
  number: string;
  street: string;
  postcode: string;
  /** A flat, unit or level at this number, rather than the building itself. */
  unit: boolean;
}

/**
 * One state's addresses as places, in batches: one for each number on each street.
 *
 * - Flats, units and levels share their building's number, and search reads "3/12 Smith Street" as
 *   number 12, so they collapse to one place: the building's own point where G-NAF has one.
 * - A range ("12-14") goes under its first number, which is how search looks one up.
 * - Left out: retired addresses, other names for an address already listed (aliases), addresses
 *   no source vouches for any more (confidence below 0), and those with a lot number only.
 *
 * The state's kept addresses are held in memory between its two big files (about 3 million for New
 * South Wales, the largest).
 */
export async function* gnafAddresses(state: GnafState, tables: GnafTables, batchSize = 5000): AsyncGenerator<PlaceRecord[]> {
  const suffixes = new Map<string, string>();
  for await (const [code, name] of tables.streetSuffixes) if (code) suffixes.set(code, name ?? '');

  const localities = new Map<string, { name: string; postcode: string }>();
  for await (const [pid, name, postcode, retired] of tables.localities) {
    if (pid && name && !retired) localities.set(pid, { name: titleCase(name), postcode: postcode ?? '' });
  }

  const streets = new Map<string, { name: string; locality: string }>();
  for await (const [pid, name, type, suffix, locality, retired] of tables.streets) {
    if (!pid || !name || !locality || retired) continue;
    const words = [name, type, suffix ? (suffixes.get(suffix) ?? '') : ''].filter(Boolean).join(' ');
    streets.set(pid, { name: titleCase(words), locality });
  }

  const byNumber = new Map<string, Kept>();
  for await (const [pid, retired, flat, level, prefix, first, suffix, street, alias, postcode, confidence] of tables.details) {
    if (!pid || retired || alias === 'A' || !first || !street || Number(confidence) < 0) continue;
    if (!streets.has(street)) continue;
    const number = `${prefix ?? ''}${first}${suffix ?? ''}`.toUpperCase();
    const key = `${street}|${number}`;
    const unit = Boolean(flat || level);
    const had = byNumber.get(key);
    if (had && (!had.unit || unit)) continue;
    byNumber.set(key, { pid, number, street, postcode: postcode ?? '', unit });
  }
  const byPid = new Map<string, Kept>();
  for (const k of byNumber.values()) byPid.set(k.pid, k);
  byNumber.clear();

  let batch: PlaceRecord[] = [];
  for await (const [pid, lonText, latText, retired] of tables.geocodes) {
    const k = pid ? byPid.get(pid) : undefined;
    if (!k || retired) continue;
    const lon = Number(lonText);
    const lat = Number(latText);
    // Australia and its islands, give or take: anything else is a mistake in the file.
    if (!lonText || !latText || !(lon > 95 && lon < 170 && lat > -55 && lat < -8)) continue;
    byPid.delete(pid!);
    const street = streets.get(k.street)!;
    const locality = localities.get(street.locality);
    const postcode = k.postcode || locality?.postcode || null;
    batch.push({
      id: k.pid,
      name: `${k.number} ${street.name}`,
      kind: 'address',
      category: null,
      description: [locality?.name, postcode].filter(Boolean).join(' '),
      lon,
      lat,
      importance: 0,
      suburb: locality?.name ?? null,
      state,
      postcode,
      poiType: null,
      brand: null,
      openingHours: null,
    });
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

/** One state's addresses from its files, unzipped (without their folders) into `dir`. */
export function gnafAddressesFromFiles(state: GnafState, dir: string): AsyncGenerator<PlaceRecord[]> {
  const file = (table: string) => join(dir, `${state}_${table}_psv.psv`);
  return gnafAddresses(state, {
    streetSuffixes: readPsv(join(dir, STREET_SUFFIX_FILE), SUFFIX_COLUMNS),
    localities: readPsv(file('LOCALITY'), LOCALITY_COLUMNS),
    streets: readPsv(file('STREET_LOCALITY'), STREET_COLUMNS),
    details: readPsv(file('ADDRESS_DETAIL'), DETAIL_COLUMNS),
    geocodes: readPsv(file('ADDRESS_DEFAULT_GEOCODE'), GEOCODE_COLUMNS),
  });
}

/** True for a place that came from G-NAF: its ids all start "GA" ("GAQLD155000000"). */
export const GNAF_ID_PREFIX = 'GA';
