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
  'w/turn:lanes',
  'w/turn:lanes:forward',
  'w/turn:lanes:backward',
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

export interface WayLanesRecord {
  wayId: number;
  /** turn:lanes in the way's direction and against it, as tagged. */
  forward: string | null;
  backward: string | null;
  coords: Array<[number, number]>;
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

/** Ways that only go one way: tagged so, or one-way by kind (motorways, roundabouts). */
function oneWay(t: GeoJsonFeature['properties']): 'forward' | 'backward' | null {
  const oneway = str(t, 'oneway');
  if (oneway === '-1') return 'backward';
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') return 'forward';
  if (oneway === 'no') return null;
  if (str(t, 'highway') === 'motorway' || str(t, 'junction') === 'roundabout' || str(t, 'junction') === 'circular') return 'forward';
  return null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A way's lane markings for each direction, or null when it has none the routes can use. On a
 * one-way road `turn:lanes` is for the way it goes; on a two-way road only `:forward` and
 * `:backward` say which side they're for.
 */
export function featureToWayLanes(f: GeoJsonFeature): WayLanesRecord | null {
  const wayId = osmId(f, 'w');
  if (wayId === null || f.geometry?.type !== 'LineString') return null;
  const t = f.properties;
  const one = oneWay(t);
  const plain = str(t, 'turn:lanes')?.trim() || null;
  let forward = str(t, 'turn:lanes:forward')?.trim() || null;
  let backward = str(t, 'turn:lanes:backward')?.trim() || null;
  if (one === 'forward') forward ??= plain;
  if (one === 'backward') backward ??= plain;
  if (one === 'forward') backward = null;
  if (one === 'backward') forward = null;
  if (!forward && !backward) return null;
  const coords = (f.geometry.coordinates as number[][]).map(([lon, lat]) => [round6(lon!), round6(lat!)] as [number, number]);
  if (coords.length < 2) return null;
  return { wayId, forward, backward, coords };
}

const BATCH = 5000;

/** The tables a road facts import replaces together. */
const TABLES = ['traffic_signals', 'way_speed_rules', 'way_lanes'] as const;

/**
 * Load an `osmium export -f geojsonseq` file of the road filters into staging tables, then swap them
 * in for `traffic_signals`, `way_speed_rules` and `way_lanes` together. Returns how many of each were imported.
 */
export async function importRoadFacts(
  db: Db,
  path: string,
  log: (m: string) => void = () => undefined,
  boundaries: BoundaryIndex | null = null,
): Promise<{ signals: number; rules: number; lanes: number }> {
  for (const table of TABLES) {
    await db.query(`DROP TABLE IF EXISTS ${table}_staging`);
    await db.query(`CREATE TABLE ${table}_staging (LIKE ${table} INCLUDING ALL)`);
  }

  let signals: SignalRecord[] = [];
  let rules: WayRuleRecord[] = [];
  let lanes: WayLanesRecord[] = [];
  const counts = { signals: 0, rules: 0, lanes: 0 };
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
    if (lanes.length) {
      await db.query(
        `INSERT INTO way_lanes_staging (way_id, forward, backward, coords)
         SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::jsonb[]) ON CONFLICT DO NOTHING`,
        [lanes.map((l) => String(l.wayId)), lanes.map((l) => l.forward), lanes.map((l) => l.backward), lanes.map((l) => JSON.stringify(l.coords))],
      );
      counts.lanes += lanes.length;
      lanes = [];
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
    const wayLanes = featureToWayLanes(f);
    if (wayLanes) lanes.push(wayLanes);
    if (signals.length + rules.length + lanes.length >= BATCH) await flush();
  }
  await flush();

  await withTransaction(db, async (tx) => {
    for (const table of TABLES) {
      await tx.query(`DROP TABLE ${table}`);
      await tx.query(`ALTER TABLE ${table}_staging RENAME TO ${table}`);
      // LIKE … INCLUDING ALL names its copies after the staging table; give them the usual names.
      await tx.query(`ALTER INDEX IF EXISTS ${table}_staging_pkey RENAME TO ${table}_pkey`);
    }
    const point = await tx.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'traffic_signals' AND indexname <> 'traffic_signals_pkey'",
    );
    for (const r of point.rows) await tx.query(`ALTER INDEX ${r.indexname} RENAME TO traffic_signals_point_idx`);
  });
  log(`road facts import complete: ${counts.signals} traffic lights, ${counts.rules} roads with limit rules, ${counts.lanes} roads with lanes`);
  return counts;
}
