/**
 * Speed limit signs from the Queensland Government's survey of state and local roads ("Speed Limits
 * for state and local roads", data.qld.gov.au, CC BY 4.0): about 215,000 signs, and the limits that
 * apply on roads with no sign, surveyed in 2019-20 and not updated since. Routes use them only
 * where the map has no limit of its own, so they fill gaps without overriding newer OSM data.
 *
 * This is the one outside download besides the OpenStreetMap extract, agreed for this purpose. It
 * runs only when an admin imports it (speed-signs-cli), never while anyone uses the app.
 */
import { type Db, withTransaction } from '@wayfinder/core';

/** The dataset's description, which lists a CSV for each region. */
export const QLD_SPEED_SIGNS_DATASET = 'https://www.data.qld.gov.au/api/3/action/package_show?id=speed-limits-for-state-and-local-roads';

export interface SpeedSignRecord {
  id: string;
  lon: number;
  lat: number;
  kmh: number;
  bearing: number;
  unsigned: boolean;
  surveyedOn: string | null;
}

const BEARING: Record<string, number> = {
  NORTH: 0,
  NORTHEAST: 45,
  EAST: 90,
  SOUTHEAST: 135,
  SOUTH: 180,
  SOUTHWEST: 225,
  WEST: 270,
  NORTHWEST: 315,
};

/**
 * Signs that set a limit until the next one: the speed limit signs (R4-1), "area" limit signs
 * (R4-10), and roads the survey noted as unsigned. Left out: school zones (R4-Q01), the ends of
 * areas (R4-11), roadworks (TC), shared zones and the like, and any sign with words on it beyond
 * "speed limit" (ramp speeds, wildlife zones at night), which hold only some of the time.
 */
const LIMIT_SIGN = /^(R4-1[A-D]?|R4-10[A-B]?|UNSIGNED)$/;

/** Split CSV text into rows of fields, with quoted fields and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** "5/08/2019" as "2019-08-05", or null. */
function surveyDate(d: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

/** A sign from one row of the survey (by its column names), or null for one routes can't use. */
export function rowToSign(r: Record<string, string | undefined>): SpeedSignRecord | null {
  const id = r.NUMBER?.trim();
  const lat = Number(r.LATITUDE);
  const lon = Number(r.LONGITUDE);
  const kmh = Number(r.SPEED);
  const bearing = BEARING[(r.DIRECTION ?? '').trim().toUpperCase()];
  const text = (r.SIGN_TXT ?? '').trim().toUpperCase();
  const code = (r.SIGN_NUM ?? '').trim().toUpperCase();
  if (!id || bearing === undefined) return null;
  if (!LIMIT_SIGN.test(code) || (text !== '' && text !== 'SPEED LIMIT')) return null;
  if (!Number.isInteger(kmh) || kmh < 5 || kmh > 130) return null;
  // Queensland, give or take: a point outside it is a typo in the survey.
  if (!(lat > -29.5 && lat < -9 && lon > 137.5 && lon < 154)) return null;
  return { id, lon, lat, kmh, bearing, unsigned: code === 'UNSIGNED', surveyedOn: surveyDate(r.DATE ?? '') };
}

/** The usable signs in one of the survey's CSV files. */
export function signsFromCsv(text: string): SpeedSignRecord[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!header) return [];
  const names = header.map((h) => h.trim().toUpperCase());
  const out: SpeedSignRecord[] = [];
  for (const row of rows) {
    const sign = rowToSign(Object.fromEntries(names.map((n, i) => [n, row[i]])));
    if (sign) out.push(sign);
  }
  return out;
}

const BATCH = 5000;

/** Replace `speed_signs` with these signs, swapped in at once. Returns how many went in. */
export async function importSpeedSigns(db: Db, files: AsyncIterable<SpeedSignRecord[]> | Iterable<SpeedSignRecord[]>, log: (m: string) => void = () => undefined): Promise<number> {
  await db.query('DROP TABLE IF EXISTS speed_signs_staging');
  await db.query('CREATE TABLE speed_signs_staging (LIKE speed_signs INCLUDING ALL)');
  let count = 0;
  for await (const signs of files) {
    for (let i = 0; i < signs.length; i += BATCH) {
      const b = signs.slice(i, i + BATCH);
      const r = await db.query(
        `INSERT INTO speed_signs_staging (id, lon, lat, kmh, bearing, unsigned, surveyed_on)
         SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[], $4::smallint[], $5::smallint[], $6::boolean[], $7::date[])
         ON CONFLICT DO NOTHING`,
        [b.map((s) => s.id), b.map((s) => s.lon), b.map((s) => s.lat), b.map((s) => s.kmh), b.map((s) => s.bearing), b.map((s) => s.unsigned), b.map((s) => s.surveyedOn)],
      );
      count += r.rowCount ?? 0;
    }
  }
  await withTransaction(db, async (tx) => {
    await tx.query('DROP TABLE speed_signs');
    await tx.query('ALTER TABLE speed_signs_staging RENAME TO speed_signs');
    await tx.query('ALTER INDEX IF EXISTS speed_signs_staging_pkey RENAME TO speed_signs_pkey');
    const point = await tx.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'speed_signs' AND indexname <> 'speed_signs_pkey'");
    for (const r of point.rows) await tx.query(`ALTER INDEX ${r.indexname} RENAME TO speed_signs_point_idx`);
  });
  log(`speed signs import complete: ${count} signs`);
  return count;
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

/** The CSV files the dataset lists, by region. */
export async function surveyCsvUrls(fetchImpl: Fetch, dataset = QLD_SPEED_SIGNS_DATASET): Promise<Array<{ name: string; url: string }>> {
  const res = await fetchImpl(dataset);
  if (!res.ok) throw new Error(`The speed signs dataset answered ${res.status}`);
  const body = (await res.json()) as { result?: { resources?: Array<{ name?: string; url?: string; format?: string }> } };
  const files = (body.result?.resources ?? [])
    .filter((r) => (r.format ?? '').toUpperCase() === 'CSV' && typeof r.url === 'string' && r.url.startsWith('https://'))
    .map((r) => ({ name: r.name ?? r.url!, url: r.url! }));
  if (files.length === 0) throw new Error('The speed signs dataset lists no CSV files');
  return files;
}

/** Download every region's CSV and import the signs. */
export async function downloadSpeedSigns(db: Db, fetchImpl: Fetch, log: (m: string) => void = () => undefined): Promise<number> {
  const files = await surveyCsvUrls(fetchImpl);
  log(`downloading ${files.length} regions`);
  async function* regions() {
    for (const f of files) {
      const res = await fetchImpl(f.url);
      if (!res.ok) throw new Error(`${f.name}: download answered ${res.status}`);
      const signs = signsFromCsv(await res.text());
      log(`${f.name}: ${signs.length} signs`);
      yield signs;
    }
  }
  return importSpeedSigns(db, regions(), log);
}
