import { type LngLat, cumulativeM, localDayHour, projectOntoSegment, timeZoneAt } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';

/**
 * Typical speeds on roads, learned from the group's own drives: each matched car trip says how long
 * it took along each road, and a nightly job keeps the median for each road by weekday or weekend and
 * hour wherever enough separate trips agree. Routes then take the time drives really take there.
 */

/** Separate trips a road needs at a time of day before its learned speed is used. */
export const MIN_TRIPS = 3;
/**
 * Separate people those trips must come from: everyone's routes go by these speeds, so one person's
 * drives (or made-up tracks) can't set a road's speed for the rest.
 */
export const MIN_PEOPLE = 2;
/** Only recent drives count: roads change, and so does traffic. */
export const SAMPLE_DAYS = 180;
/** Stretches shorter than this say more about GPS error than about speed. */
const MIN_STRETCH_M = 150;
/** A raw fix farther than this from the matched line isn't used to time it. */
const MAX_FIX_OFF_M = 30;
/** A gap in the fixes longer than this at either end of a stretch leaves its timing unknown. */
const MAX_GAP_MS = 30_000;

export interface SpeedSample {
  wayId: number;
  dayKind: 0 | 1;
  hour: number;
  kmh: number;
  lengthM: number;
  observedAt: Date;
  /** The limit the map gave the road there, where it had one. */
  limitKmh: number | null;
  /** The middle of the stretch timed. */
  at: LngLat;
}

export const dayKindOf = (day: number): 0 | 1 => (day === 0 || day === 6 ? 1 : 0);

/** A fix placed along the matched line: how far along it, and when. */
export interface PlacedFix {
  m: number;
  ts: number;
}

/**
 * Each raw fix's distance along the matched line, never going backwards (each placed no further back
 * than the one before). Fixes further than MAX_FIX_OFF_M from the line are left out.
 */
export function placeFixes(matched: readonly LngLat[], cum: readonly number[], fixes: ReadonlyArray<{ lon: number; lat: number; ts: number }>): PlacedFix[] {
  const placed: PlacedFix[] = [];
  let segment = 0;
  for (const f of fixes) {
    let best: { m: number; d: number; seg: number } | null = null;
    for (let i = segment; i < Math.min(matched.length - 1, segment + 60); i++) {
      const proj = projectOntoSegment([f.lon, f.lat], matched[i]!, matched[i + 1]!);
      if (!best || proj.distanceM < best.d) best = { m: cum[i]! + (cum[i + 1]! - cum[i]!) * proj.t, d: proj.distanceM, seg: i };
    }
    if (!best || best.d > MAX_FIX_OFF_M) continue;
    segment = best.seg;
    placed.push({ m: Math.max(best.m, placed.at(-1)?.m ?? 0), ts: f.ts });
  }
  return placed;
}

/** Two fixes this close along the line were standing still between them, however long apart in time. */
const STILL_M = 15;
/** ...up to this long: longer, it was parked, or the phone lost its position, not a wait in traffic. */
const MAX_STILL_MS = 10 * 60_000;

/**
 * Whether the time between two fixes is known: they're at most `maxGapMs` apart, or the car didn't
 * move between them. Navigation asks for a fix every second or every 5 m, so a car waiting at the
 * lights sends none until it moves off; that silence is a wait, not missing data.
 */
export function timedBetween(a: PlacedFix, b: PlacedFix, maxGapMs: number): boolean {
  const gap = b.ts - a.ts;
  return gap <= maxGapMs || (b.m - a.m <= STILL_M && gap <= MAX_STILL_MS);
}

/** When the trip was at distance m along the line, or null where the time between the fixes either side isn't known. */
export function timeAlong(placed: readonly PlacedFix[], m: number, maxGapMs: number): number | null {
  const after = placed.findIndex((p) => p.m >= m);
  if (after <= 0) return null;
  const a = placed[after - 1]!;
  const b = placed[after]!;
  if (!timedBetween(a, b, maxGapMs)) return null;
  return b.m === a.m ? a.ts : a.ts + ((b.ts - a.ts) * (m - a.m)) / (b.m - a.m);
}

/**
 * How fast a trip went along each road it was matched to. The raw fixes are placed along the matched
 * line (each no further back than the one before), and each road's stretch is timed between where
 * the trip reached its start and its end. The first and last road are left out (setting off and
 * parking), as are short stretches, gaps in the fixes and impossible speeds.
 */
export function speedSamples(
  matched: readonly LngLat[],
  wayRuns: ReadonlyArray<readonly [number, number, number]>,
  fixes: ReadonlyArray<{ lon: number; lat: number; ts: number }>,
  limitRuns: ReadonlyArray<readonly [number, number, number | null]> = [],
): SpeedSample[] {
  if (matched.length < 2 || fixes.length < 2) return [];
  const cum = cumulativeM(matched);
  const placed = placeFixes(matched, cum, fixes);
  if (placed.length < 2) return [];
  const timeAt = (m: number) => timeAlong(placed, m, MAX_GAP_MS);
  const runs = wayRuns.filter(([, , id]) => id > 0);
  const out: SpeedSample[] = [];
  runs.forEach(([from, to, wayId], i) => {
    if (i === 0 || i === runs.length - 1) return;
    const m0 = cum[from]!;
    const m1 = cum[Math.min(to, cum.length - 1)]!;
    const lengthM = m1 - m0;
    if (lengthM < MIN_STRETCH_M) return;
    const t0 = timeAt(m0);
    const t1 = timeAt(m1);
    if (t0 === null || t1 === null || t1 <= t0) return;
    const kmh = (lengthM / ((t1 - t0) / 1000)) * 3.6;
    if (kmh < 3 || kmh > 150) return;
    const observedAt = new Date(t0);
    const { day, hour } = localDayHour(observedAt, timeZoneAt(matched[from]!));
    const mid = Math.floor((from + Math.min(to, matched.length - 1)) / 2);
    const limit = limitRuns.find(([a, b]) => a <= mid && mid < b)?.[2];
    const limitKmh = typeof limit === 'number' && limit > 0 && limit <= 130 ? Math.round(limit) : null;
    out.push({ wayId, dayKind: dayKindOf(day), hour, kmh, lengthM, observedAt, limitKmh, at: matched[mid]! });
  });
  return out;
}

/** Replace a trip's samples (a trip still being recorded is matched again as it grows). */
export async function recordSpeedSamples(db: DbClient, tripId: string, samples: readonly SpeedSample[]): Promise<void> {
  await db.query('DELETE FROM road_speed_samples WHERE trip_id = $1', [tripId]);
  if (samples.length === 0) return;
  await db.query(
    `INSERT INTO road_speed_samples (trip_id, way_id, day_kind, hour, kmh, length_m, observed_at, limit_kmh, lon, lat)
     SELECT $1, * FROM unnest($2::bigint[], $3::smallint[], $4::smallint[], $5::real[], $6::real[], $7::timestamptz[],
                              $8::smallint[], $9::float8[], $10::float8[])`,
    [
      tripId,
      samples.map((s) => String(s.wayId)),
      samples.map((s) => s.dayKind),
      samples.map((s) => s.hour),
      samples.map((s) => s.kmh),
      samples.map((s) => s.lengthM),
      samples.map((s) => s.observedAt.toISOString()),
      samples.map((s) => s.limitKmh),
      samples.map((s) => s.at[0]),
      samples.map((s) => s.at[1]),
    ],
  );
}

/**
 * Rebuild the typical speeds for each road, weekday or weekend, and hour (and for the whole day, hour
 * 24): each person's median, then the median of those, so everyone counts once however often they
 * drive it. Kept only where at least MIN_TRIPS trips from MIN_PEOPLE people agree. Only drives that
 * still stand count: not a trip deleted or since marked as a walk, nor a deleted, disabled
 * or test account's. Samples older than SAMPLE_DAYS are dropped.
 */
export async function rebuildRoadSpeeds(db: DbClient): Promise<{ roads: number; pruned: number; limitChecks: number }> {
  const pruned = await db.query(`DELETE FROM road_speed_samples WHERE observed_at < now() - make_interval(days => $1)`, [SAMPLE_DAYS]);
  await db.query('DELETE FROM road_speeds');
  await db.query(
    `WITH live AS (
       SELECT s.way_id, s.day_kind, s.hour, s.kmh, s.trip_id, t.user_id
       FROM road_speed_samples s
       JOIN trips t ON t.id = s.trip_id AND t.deleted_at IS NULL AND t.mode = 'car'
       JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND NOT u.test_account
     ),
     per_person AS (
       SELECT way_id, day_kind, hour, user_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY kmh) AS kmh, count(DISTINCT trip_id) AS trips
       FROM live GROUP BY way_id, day_kind, hour, user_id
       UNION ALL
       SELECT way_id, day_kind, 24, user_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY kmh), count(DISTINCT trip_id)
       FROM live GROUP BY way_id, day_kind, user_id
     )
     INSERT INTO road_speeds (way_id, day_kind, hour, kmh, trips)
     SELECT way_id, day_kind, hour, percentile_cont(0.5) WITHIN GROUP (ORDER BY kmh), sum(trips)
     FROM per_person GROUP BY way_id, day_kind, hour
     HAVING sum(trips) >= $1 AND count(*) >= $2`,
    [MIN_TRIPS, MIN_PEOPLE],
  );
  const roads = await db.query<{ n: string }>('SELECT count(DISTINCT way_id) AS n FROM road_speeds');
  const limitChecks = await rebuildLimitChecks(db);
  return { roads: Number(roads.rows[0]!.n), pruned: pruned.rowCount ?? 0, limitChecks };
}

/** Drives typically this much faster than a road's limit suggest the limit shown is too low. */
export const OVER_LIMIT_KMH = 15;
/**
 * Drives this much slower than the limit even at their quicker (85th percentile) suggest it is too
 * high: on a fast road only, where a street given the 100 km/h rural default is the likely mistake.
 * A slow road's drivers are often held up, which says nothing about its limit.
 */
export const UNDER_LIMIT_KMH = 30;
const UNDER_LIMIT_FROM_KMH = 80;

/**
 * Rebuild the list of roads whose limit the group's drives suggest is wrong, for an admin to check:
 * where at least MIN_TRIPS trips from MIN_PEOPLE people (each counted once, as for speeds) went
 * typically OVER_LIMIT_KMH faster than the limit the map gave the road, or UNDER_LIMIT_KMH slower
 * even at their quickest on a fast road. Only drives that still stand count.
 */
export async function rebuildLimitChecks(db: DbClient): Promise<number> {
  await db.query('DELETE FROM limit_checks');
  const r = await db.query(
    `WITH live AS (
       SELECT s.way_id, s.kmh, s.limit_kmh, s.lon, s.lat, s.trip_id, t.user_id
       FROM road_speed_samples s
       JOIN trips t ON t.id = s.trip_id AND t.deleted_at IS NULL AND t.mode = 'car'
       JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND NOT u.test_account
       WHERE s.limit_kmh IS NOT NULL AND s.lon IS NOT NULL
     ),
     per_person AS (
       SELECT way_id, user_id,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY kmh) AS kmh,
              percentile_cont(0.85) WITHIN GROUP (ORDER BY kmh) AS quick_kmh,
              count(DISTINCT trip_id) AS trips
       FROM live GROUP BY way_id, user_id
     ),
     per_way AS (
       SELECT p.way_id,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p.kmh) AS typical,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY p.quick_kmh) AS quick,
              sum(p.trips) AS trips, count(*) AS people
       FROM per_person p GROUP BY p.way_id
     ),
     facts AS (
       SELECT way_id, mode() WITHIN GROUP (ORDER BY limit_kmh) AS limit_kmh, avg(lon) AS lon, avg(lat) AS lat
       FROM live GROUP BY way_id
     )
     INSERT INTO limit_checks (way_id, limit_kmh, typical_kmh, trips, people, lon, lat)
     SELECT w.way_id, f.limit_kmh, w.typical, w.trips, w.people, f.lon, f.lat
     FROM per_way w JOIN facts f USING (way_id)
     WHERE w.trips >= $1 AND w.people >= $2
       AND (w.typical >= f.limit_kmh + $3 OR (f.limit_kmh >= $5 AND w.quick <= f.limit_kmh - $4))`,
    [MIN_TRIPS, MIN_PEOPLE, OVER_LIMIT_KMH, UNDER_LIMIT_KMH, UNDER_LIMIT_FROM_KMH],
  );
  return r.rowCount ?? 0;
}

export interface LimitCheck {
  wayId: string;
  limitKmh: number;
  typicalKmh: number;
  trips: number;
  people: number;
  location: LngLat;
}

/** The roads whose limit drives suggest is wrong, the furthest off first. */
export async function listLimitChecks(db: DbClient, limit = 200): Promise<LimitCheck[]> {
  const r = await db.query<{ way_id: string; limit_kmh: number; typical_kmh: number; trips: number; people: number; lon: number; lat: number }>(
    `SELECT way_id::text, limit_kmh, typical_kmh, trips, people, lon, lat FROM limit_checks
     ORDER BY abs(typical_kmh - limit_kmh) DESC, way_id LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    wayId: x.way_id,
    limitKmh: Number(x.limit_kmh),
    typicalKmh: Math.round(Number(x.typical_kmh)),
    trips: Number(x.trips),
    people: Number(x.people),
    location: [Number(x.lon), Number(x.lat)],
  }));
}

/**
 * Typical km/h on these ways for a trip setting off now from `start`: that hour's where it has enough
 * trips, else the whole day's.
 */
export async function learnedSpeeds(db: DbClient, wayIds: readonly number[], now: Date, start: LngLat): Promise<Map<number, number>> {
  if (wayIds.length === 0) return new Map();
  const { day, hour } = localDayHour(now, timeZoneAt(start));
  const r = await db.query<{ way_id: string; kmh: number }>(
    `SELECT DISTINCT ON (way_id) way_id::text, kmh FROM road_speeds
     WHERE way_id = ANY($1::bigint[]) AND day_kind = $2 AND hour IN ($3, 24)
     ORDER BY way_id, hour = 24`,
    [wayIds.map(String), dayKindOf(day), hour],
  );
  return new Map(r.rows.map((x) => [Number(x.way_id), Number(x.kmh)]));
}
