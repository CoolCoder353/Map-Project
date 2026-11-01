import { type LngLat, cumulativeM, localDayHour, projectOntoSegment, timeZoneAt } from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';

/**
 * Typical speeds on roads, learned from the group's own drives: each matched car trip says how long
 * it took along each road, and a nightly job keeps the median for each road by weekday or weekend and
 * hour wherever enough separate trips agree. Routes then take the time drives really take there.
 */

/** Separate trips a road needs at a time of day before its learned speed is used. */
export const MIN_TRIPS = 3;
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
}

const dayKindOf = (day: number): 0 | 1 => (day === 0 || day === 6 ? 1 : 0);

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
): SpeedSample[] {
  if (matched.length < 2 || fixes.length < 2) return [];
  const cum = cumulativeM(matched);
  // Each fix's distance along the matched line, never going backwards.
  const placed: Array<{ m: number; ts: number }> = [];
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
  if (placed.length < 2) return [];
  /** When the trip was at distance m along the line, or null where the fixes around it are too far apart. */
  const timeAt = (m: number): number | null => {
    const after = placed.findIndex((p) => p.m >= m);
    if (after <= 0) return null;
    const a = placed[after - 1]!;
    const b = placed[after]!;
    if (b.ts - a.ts > MAX_GAP_MS) return null;
    return b.m === a.m ? a.ts : a.ts + ((b.ts - a.ts) * (m - a.m)) / (b.m - a.m);
  };
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
    out.push({ wayId, dayKind: dayKindOf(day), hour, kmh, lengthM, observedAt });
  });
  return out;
}

/** Replace a trip's samples (a trip still being recorded is matched again as it grows). */
export async function recordSpeedSamples(db: DbClient, tripId: string, samples: readonly SpeedSample[]): Promise<void> {
  await db.query('DELETE FROM road_speed_samples WHERE trip_id = $1', [tripId]);
  if (samples.length === 0) return;
  await db.query(
    `INSERT INTO road_speed_samples (trip_id, way_id, day_kind, hour, kmh, length_m, observed_at)
     SELECT $1, * FROM unnest($2::bigint[], $3::smallint[], $4::smallint[], $5::real[], $6::real[], $7::timestamptz[])`,
    [
      tripId,
      samples.map((s) => String(s.wayId)),
      samples.map((s) => s.dayKind),
      samples.map((s) => s.hour),
      samples.map((s) => s.kmh),
      samples.map((s) => s.lengthM),
      samples.map((s) => s.observedAt.toISOString()),
    ],
  );
}

/**
 * Rebuild the typical speeds: the median of recent samples for each road, weekday or weekend, and
 * hour (and for the whole day, hour 24), kept only where at least MIN_TRIPS separate trips agree.
 * Samples older than SAMPLE_DAYS are dropped.
 */
export async function rebuildRoadSpeeds(db: DbClient): Promise<{ roads: number; pruned: number }> {
  const pruned = await db.query(`DELETE FROM road_speed_samples WHERE observed_at < now() - make_interval(days => $1)`, [SAMPLE_DAYS]);
  await db.query('DELETE FROM road_speeds');
  await db.query(
    `INSERT INTO road_speeds (way_id, day_kind, hour, kmh, trips)
     SELECT way_id, day_kind, hour, percentile_cont(0.5) WITHIN GROUP (ORDER BY kmh), count(DISTINCT trip_id)
     FROM road_speed_samples GROUP BY way_id, day_kind, hour HAVING count(DISTINCT trip_id) >= $1
     UNION ALL
     SELECT way_id, day_kind, 24, percentile_cont(0.5) WITHIN GROUP (ORDER BY kmh), count(DISTINCT trip_id)
     FROM road_speed_samples GROUP BY way_id, day_kind HAVING count(DISTINCT trip_id) >= $1`,
    [MIN_TRIPS],
  );
  const roads = await db.query<{ n: string }>('SELECT count(DISTINCT way_id) AS n FROM road_speeds');
  return { roads: Number(roads.rows[0]!.n), pruned: pruned.rowCount ?? 0 };
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
