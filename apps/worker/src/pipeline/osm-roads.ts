import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SignalKind } from '@wayfinder/shared';
import { type Db, withTransaction } from '@wayfinder/core';
import type { BoundaryIndex } from './boundaries.js';
import { type GeoJsonFeature, representativePoint } from './osm-places.js';

/** What osmium keeps for road facts: traffic lights, and ways with limits a graph can't hold. */
export const OSMIUM_ROAD_FILTERS = [
  'n/highway=traffic_signals',
  'n/crossing=traffic_signals',
  'w/maxspeed:conditional',
  'w/maxspeed:variable',
  'w/maxspeed=signals',
];

export interface SignalRecord {
  id: number;
  lon: number;
  lat: number;
  kind: SignalKind;
}

export interface WayRuleRecord {
  wayId: number;
  conditional: string | null;
  variable: boolean;
  /** Where the way is, for its state's time zone. */
  point: [number, number] | null;
}

const str = (tags: GeoJsonFeature['properties'], k: string) => (typeof tags[k] === 'string' ? (tags[k] as string) : undefined);

/** Exported with `--add-unique-id=type_id`, so ids look like "n123" / "w456". */
function osmId(f: GeoJsonFeature, type: 'n' | 'w'): number | null {
  const m = new RegExp(`^${type}(\\d+)$`).exec(String(f.id ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * A traffic light from an exported node, or null for lights that don't stop traffic in the usual
 * way: flashing amber (`blinker`), and lights only used by fire engines (`emergency`).
 */
export function featureToSignal(f: GeoJsonFeature): SignalRecord | null {
  const id = osmId(f, 'n');
  if (id === null || f.geometry?.type !== 'Point') return null;
  const [lon, lat] = f.geometry.coordinates as [number, number];
  const t = f.properties;
  const signals = str(t, 'traffic_signals');
  if (signals === 'blinker' || signals === 'emergency') return null;
  let kind: SignalKind;
  if (signals === 'ramp_meter') kind = 'ramp_meter';
  else if (str(t, 'highway') === 'traffic_signals' && signals !== 'crossing_only') kind = 'signals';
  else if (str(t, 'crossing') === 'traffic_signals' || signals === 'crossing_only') kind = 'crossing';
  else return null;
  return { id, lon, lat, kind };
}

/** A way's speed-limit rules, or null when it has none the routes use. */
export function featureToWayRule(f: GeoJsonFeature): WayRuleRecord | null {
  const wayId = osmId(f, 'w');
  if (wayId === null) return null;
  const t = f.properties;
  const conditional = str(t, 'maxspeed:conditional')?.trim() || null;
  const variable = (str(t, 'maxspeed:variable') ?? 'no') !== 'no' || str(t, 'maxspeed') === 'signals';
  if (!conditional && !variable) return null;
  return { wayId, conditional, variable, point: representativePoint(f.geometry) };
}

const BATCH = 5000;

/**
 * Load an `osmium export -f geojsonseq` file of the road filters into staging tables, then swap them
 * in for `traffic_signals` and `way_speed_rules` together. Returns how many of each were imported.
 */
export async function importRoadFacts(
  db: Db,
  path: string,
  log: (m: string) => void = () => undefined,
  boundaries: BoundaryIndex | null = null,
): Promise<{ signals: number; rules: number }> {
  await db.query('DROP TABLE IF EXISTS traffic_signals_staging');
  await db.query('DROP TABLE IF EXISTS way_speed_rules_staging');
  await db.query('CREATE TABLE traffic_signals_staging (LIKE traffic_signals INCLUDING ALL)');
  await db.query('CREATE TABLE way_speed_rules_staging (LIKE way_speed_rules INCLUDING ALL)');

  let signals: SignalRecord[] = [];
  let rules: WayRuleRecord[] = [];
  const counts = { signals: 0, rules: 0 };
  const flush = async () => {
    if (signals.length) {
      await db.query(
        `INSERT INTO traffic_signals_staging (id, lon, lat, kind)
         SELECT * FROM unnest($1::bigint[], $2::float8[], $3::float8[], $4::text[]) ON CONFLICT DO NOTHING`,
        [signals.map((s) => String(s.id)), signals.map((s) => s.lon), signals.map((s) => s.lat), signals.map((s) => s.kind)],
      );
      counts.signals += signals.length;
      signals = [];
    }
    if (rules.length) {
      await db.query(
        `INSERT INTO way_speed_rules_staging (way_id, conditional, variable, state)
         SELECT * FROM unnest($1::bigint[], $2::text[], $3::boolean[], $4::text[]) ON CONFLICT DO NOTHING`,
        [
          rules.map((r) => String(r.wayId)),
          rules.map((r) => r.conditional),
          rules.map((r) => r.variable),
          rules.map((r) => (r.point && boundaries?.state(r.point)) ?? null),
        ],
      );
      counts.rules += rules.length;
      rules = [];
    }
  };

  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  const RECORD_SEPARATOR = String.fromCharCode(0x1e);
  for await (const rawLine of rl) {
    const line = (rawLine.startsWith(RECORD_SEPARATOR) ? rawLine.slice(1) : rawLine).trim();
    if (!line) continue;
    let f: GeoJsonFeature;
    try {
      f = JSON.parse(line) as GeoJsonFeature;
    } catch {
      continue;
    }
    const signal = featureToSignal(f);
    if (signal) signals.push(signal);
    const rule = featureToWayRule(f);
    if (rule) rules.push(rule);
    if (signals.length + rules.length >= BATCH) await flush();
  }
  await flush();

  await withTransaction(db, async (tx) => {
    for (const table of ['traffic_signals', 'way_speed_rules']) {
      await tx.query(`DROP TABLE ${table}`);
      await tx.query(`ALTER TABLE ${table}_staging RENAME TO ${table}`);
    }
    // LIKE … INCLUDING ALL names its copies after the staging table; give them the usual names.
    await tx.query('ALTER INDEX IF EXISTS traffic_signals_staging_pkey RENAME TO traffic_signals_pkey');
    await tx.query('ALTER INDEX IF EXISTS way_speed_rules_staging_pkey RENAME TO way_speed_rules_pkey');
    const point = await tx.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'traffic_signals' AND indexname <> 'traffic_signals_pkey'",
    );
    for (const r of point.rows) await tx.query(`ALTER INDEX ${r.indexname} RENAME TO traffic_signals_point_idx`);
  });
  log(`road facts import complete: ${counts.signals} traffic lights, ${counts.rules} roads with limit rules`);
  return counts;
}
