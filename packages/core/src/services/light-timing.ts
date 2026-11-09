import {
  type BBox,
  type LightCycle,
  type LightTiming,
  type LngLat,
  type MappedSignal,
  cumulativeM,
  directionAt,
  localDayHour,
  predictLight,
  signalsAlongRoute,
  timeZoneAt,
  utcOffsetS,
} from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { dayKindOf, placeFixes, timeAlong, timedBetween } from './road-speeds.js';

/**
 * How long each set of traffic lights usually holds a car going each way through it, learned from
 * the group's own drives. Each matched car trip with fixes close enough together (navigated drives,
 * a fix a second) says, for each set of lights it went through, whether it had to stop there and for
 * how long, and when the lights most likely turned green for it. A nightly job keeps, for each set of
 * lights, way through and hour, how often drives stopped and how long they waited; and where the
 * changes to green line up from day to day, the lights' fixed cycle.
 */

/** Passes a set of lights needs, going one way at one time, before its timing is used. */
export const MIN_PASSES = 5;
/** Separate people those passes must come from, so one person's drives can't set it for everyone. */
export const MIN_PEOPLE = 2;
/** Only recent passes count: lights are retimed. */
export const PASS_DAYS = 180;
/** The newest passes, held back each night to check how well the older ones predict them. */
export const CHECK_DAYS = 14;

/** How far before the lights a stop counts as waiting at them (a short queue). */
const APPROACH_M = 120;
/** Fixes must cover from this far before the lights... */
const COVER_BEFORE_M = 100;
/** ...to this far past them... */
const COVER_AFTER_M = 10;
/** ...with no gap longer than this while moving (standing still, there are none: see timedBetween). */
const MAX_GAP_MS = 5000;
/** Slower than this between two fixes is standing still. */
const STOP_MPS = 1.5;
/** Stopped for less than this isn't a stop (a slow roll through). */
const MIN_STOP_S = 3;
/** A stop further back from the lights than this is too deep in the queue to say when they turned green. */
const FRONT_OF_QUEUE_M = 40;
/** Lights this close to where a trip starts are where it set off, not a stop on the way. */
const TRIP_START_M = 150;

export interface LightPass {
  signalId: string;
  direction: string;
  dayKind: 0 | 1;
  hour: number;
  stopped: boolean;
  waitS: number;
  /** Local date (days since 1970) and seconds past local midnight when it reached the lights (stopped: when it stopped). */
  localDay: number;
  arriveS: number;
  /** Seconds past local midnight the lights most likely turned green for it, for a stop near the front. */
  greenS: number | null;
  observedAt: Date;
}

/** Local days and seconds past midnight at a moment, where `offsetS` is the time zone's offset then. */
const localTime = (ms: number, offsetS: number) => {
  const s = ms / 1000 + offsetS;
  const day = Math.floor(s / 86_400);
  return { day, s: s - day * 86_400 };
};

/**
 * Each set of lights a matched drive went through, timed from its fixes: which way it went, whether
 * it stopped within APPROACH_M before them, for how long, and (for a stop near the front of the
 * queue) when they most likely turned green: when it moved off, less a second and a half for each
 * car ahead of it. Lights where the fixes are too far apart, or where the trip started, are skipped.
 */
export function lightPasses(
  matched: readonly LngLat[],
  fixes: ReadonlyArray<{ lon: number; lat: number; ts: number }>,
  signals: readonly MappedSignal[],
): LightPass[] {
  if (matched.length < 2 || fixes.length < 2 || signals.length === 0) return [];
  const cum = cumulativeM(matched);
  const total = cum[cum.length - 1]!;
  const placed = placeFixes(matched, cum, fixes);
  if (placed.length < 2) return [];
  const out: LightPass[] = [];
  for (const set of signalsAlongRoute(matched, signals)) {
    if (!set.id) continue;
    const lm = cum[set.index]!;
    if (lm < TRIP_START_M || lm + COVER_AFTER_M > total) continue;
    const first = placed.findIndex((p) => p.m > lm - COVER_BEFORE_M);
    const last = placed.findIndex((p) => p.m >= lm + COVER_AFTER_M);
    if (first <= 0 || last < 0) continue;
    let gappy = false;
    for (let i = first; i <= last; i++) if (!timedBetween(placed[i - 1]!, placed[i]!, MAX_GAP_MS)) gappy = true;
    if (gappy) continue;
    const crossTs = timeAlong(placed, lm, MAX_GAP_MS);
    const direction = directionAt(matched, cum, lm);
    if (crossTs === null || direction === null) continue;

    let stoppedS = 0;
    let firstStop: number | null = null;
    let lastStop: { m: number; endTs: number } | null = null;
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1]!;
      const b = placed[i]!;
      // Up to a few metres past the light: a stop line is a little before or after the mapped node.
      if (a.m < lm - APPROACH_M || a.m > lm + 3) continue;
      const dt = (b.ts - a.ts) / 1000;
      if (dt <= 0 || (b.m - a.m) / dt >= STOP_MPS) continue;
      stoppedS += dt;
      firstStop ??= a.ts;
      lastStop = { m: a.m, endTs: b.ts };
    }
    const stopped = stoppedS >= MIN_STOP_S && firstStop !== null && lastStop !== null;
    const tz = timeZoneAt(matched[set.index]!);
    const offset = utcOffsetS(new Date(crossTs), tz);
    const arrive = localTime(stopped ? firstStop! : crossTs, offset);
    let greenS: number | null = null;
    if (stopped && lm - lastStop!.m <= FRONT_OF_QUEUE_M) {
      const carsAhead = Math.floor(Math.max(0, lm - lastStop!.m - 8) / 7);
      greenS = localTime(lastStop!.endTs - (1.5 + 1.5 * carsAhead) * 1000, offset).s;
    }
    const { day, hour } = localDayHour(new Date(crossTs), tz);
    out.push({
      signalId: set.id,
      direction,
      dayKind: dayKindOf(day),
      hour,
      stopped,
      waitS: stopped ? stoppedS : 0,
      localDay: arrive.day,
      arriveS: arrive.s,
      greenS,
      observedAt: new Date(crossTs),
    });
  }
  return out;
}

/** Replace a trip's passes (a trip still being recorded is matched again as it grows). */
export async function recordLightPasses(db: DbClient, tripId: string, passes: readonly LightPass[]): Promise<void> {
  await db.query('DELETE FROM signal_passes WHERE trip_id = $1', [tripId]);
  if (passes.length === 0) return;
  await db.query(
    `INSERT INTO signal_passes (trip_id, signal_id, direction, day_kind, hour, stopped, wait_s, local_day, arrive_s, green_s, observed_at)
     SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::smallint[], $5::smallint[], $6::boolean[], $7::real[], $8::int[], $9::real[], $10::real[], $11::timestamptz[])`,
    [
      tripId,
      passes.map((p) => p.signalId),
      passes.map((p) => p.direction),
      passes.map((p) => p.dayKind),
      passes.map((p) => p.hour),
      passes.map((p) => p.stopped),
      passes.map((p) => p.waitS),
      passes.map((p) => p.localDay),
      passes.map((p) => p.arriveS),
      passes.map((p) => p.greenS),
      passes.map((p) => p.observedAt.toISOString()),
    ],
  );
}

/** A pass as the model sees it: whose it was, and nothing about the trip. */
export interface ModelPass {
  signalId: string;
  direction: string;
  dayKind: number;
  hour: number;
  userId: string;
  stopped: boolean;
  waitS: number;
  localDay: number;
  arriveS: number;
  greenS: number | null;
}

export interface TimingRow extends Omit<LightTiming, 'cycle'> {
  signalId: string;
  direction: string;
  dayKind: number;
  hour: number;
  passes: number;
  cycle: Omit<LightCycle, 'utcOffsetS'> | null;
}

const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

function weightedQuantile(items: ReadonlyArray<{ v: number; w: number }>, q: number): number {
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((a, b) => a + b.w, 0);
  let acc = 0;
  for (const it of sorted) {
    acc += it.w;
    if (acc >= q * total - 1e-9) return it.v;
  }
  return sorted.at(-1)!.v;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Shortest and longest cycle looked for, seconds. */
const MIN_CYCLE_S = 40;
const MAX_CYCLE_S = 180;
/** How tightly the changes to green must line up (mean resultant length) for a cycle to be fixed. */
const CYCLE_ALIGNMENT = 0.95;
/** Changes to green, and separate days they come from, before a cycle is looked for. */
const MIN_ONSETS = 8;
const MIN_ONSET_DAYS = 4;
/** Passes from held-back days a cycle must predict, and how many of them it must get right. */
const MIN_CHECKED = 6;
const MIN_CYCLE_ACCURACY = 0.8;

/** The cycle the changes to green fit, or null. Uses the longest cycle that fits: half a true cycle fits as well, but predicts greens that never come. */
function fitOnce(passes: readonly ModelPass[]): Omit<LightCycle, 'utcOffsetS'> | null {
  const onsets = passes.filter((p) => p.greenS !== null).map((p) => p.greenS!);
  if (onsets.length < MIN_ONSETS || new Set(passes.filter((p) => p.greenS !== null).map((p) => p.localDay)).size < MIN_ONSET_DAYS) return null;
  const fits: Array<{ c: number; r: number; x: number; y: number }> = [];
  for (let c = MIN_CYCLE_S; c <= MAX_CYCLE_S; c += 0.5) {
    let x = 0;
    let y = 0;
    for (const s of onsets) {
      const a = (2 * Math.PI * mod(s, c)) / c;
      x += Math.cos(a);
      y += Math.sin(a);
    }
    const r = Math.hypot(x, y) / onsets.length;
    if (r >= CYCLE_ALIGNMENT) fits.push({ c, r, x, y });
  }
  if (fits.length === 0) return null;
  // The longest cycle that fits, at the length within a few seconds of it that fits best.
  const longest = fits.at(-1)!.c;
  const chosen = fits.filter((f) => f.c >= longest - 3).reduce((a, b) => (b.r > a.r ? b : a));
  const { c } = chosen;
  const offsetS = mod((Math.atan2(chosen.y, chosen.x) / (2 * Math.PI)) * c, c);
  // Green lasts at least as long as drives that went through on green show, and ends before drives stopped.
  const greens = passes.filter((p) => !p.stopped).map((p) => mod(p.arriveS - offsetS, c));
  const reds = passes.filter((p) => p.stopped).map((p) => mod(p.arriveS - offsetS, c)).sort((a, b) => a - b);
  let greenS = greens.length >= 2 ? weightedQuantile(greens.map((v) => ({ v, w: 1 })), 0.9) + 2 : c * 0.45;
  if (reds.length) greenS = Math.min(greenS, reds[Math.floor(reds.length * 0.1)]!);
  greenS = Math.min(Math.max(greenS, 5), c - 5);
  return { cycleS: c, greenS, offsetS };
}

/**
 * A set of lights' fixed cycle at one hour, where it has one: the changes to green from several
 * days line up on one cycle length, and a cycle fitted without each day in turn predicts which of
 * that day's drives had to stop better than how often drives stop there does.
 */
export function fitCycle(passes: readonly ModelPass[]): Omit<LightCycle, 'utcOffsetS'> | null {
  const all = fitOnce(passes);
  if (!all) return null;
  let checked = 0;
  let right = 0;
  let baselineRight = 0;
  for (const day of new Set(passes.map((p) => p.localDay))) {
    const rest = passes.filter((p) => p.localDay !== day);
    const fit = fitOnce(rest);
    if (!fit) continue;
    const stopMostly = rest.filter((p) => p.stopped).length * 2 >= rest.length;
    for (const p of passes.filter((x) => x.localDay === day)) {
      checked++;
      if ((mod(p.arriveS - fit.offsetS, fit.cycleS) >= fit.greenS) === p.stopped) right++;
      if (stopMostly === p.stopped) baselineRight++;
    }
  }
  if (checked < MIN_CHECKED || right / checked < MIN_CYCLE_ACCURACY || right <= baselineRight) return null;
  return all;
}

/**
 * Typical timings from passes: for each set of lights, way through, weekday or weekend and hour, and
 * for the whole day (hour 24), and every way through over the whole day (direction '*'). Each person
 * counts once however often they go through (their passes share one person's weight), and a timing
 * needs MIN_PASSES passes from MIN_PEOPLE people. Cycles are only looked for hour by hour.
 */
export function buildTimings(passes: readonly ModelPass[]): TimingRow[] {
  const groups = new Map<string, { signalId: string; direction: string; dayKind: number; hour: number; passes: ModelPass[] }>();
  const add = (p: ModelPass, direction: string, hour: number) => {
    const key = `${p.signalId}|${direction}|${p.dayKind}|${hour}`;
    const g = groups.get(key);
    if (g) g.passes.push(p);
    else groups.set(key, { signalId: p.signalId, direction, dayKind: p.dayKind, hour, passes: [p] });
  };
  for (const p of passes) {
    add(p, p.direction, p.hour);
    add(p, p.direction, 24);
    add(p, '*', 24);
  }
  const rows: TimingRow[] = [];
  for (const g of groups.values()) {
    const perPerson = new Map<string, number>();
    for (const p of g.passes) perPerson.set(p.userId, (perPerson.get(p.userId) ?? 0) + 1);
    if (g.passes.length < MIN_PASSES || perPerson.size < MIN_PEOPLE) continue;
    const weighted = g.passes.map((p) => ({ p, w: 1 / perPerson.get(p.userId)! }));
    const total = weighted.reduce((a, b) => a + b.w, 0);
    const stopChance = weighted.filter((x) => x.p.stopped).reduce((a, b) => a + b.w, 0) / total;
    const stops = weighted.filter((x) => x.p.stopped).map((x) => ({ v: x.p.waitS, w: x.w }));
    const waits = stops.length ? QUANTILES.map((q) => weightedQuantile(stops, q)) : [];
    rows.push({
      signalId: g.signalId,
      direction: g.direction,
      dayKind: g.dayKind,
      hour: g.hour,
      passes: g.passes.length,
      stopChance,
      waitS: waits[2] ?? 0,
      waits,
      cycle: g.hour < 24 && g.direction !== '*' ? fitCycle(g.passes) : null,
    });
  }
  return rows;
}

/** The timing for a set of lights going one way: that hour's, else the whole day's, else every way's. */
function resolver(rows: readonly TimingRow[], utcOffset: number) {
  const byKey = new Map<string, TimingRow>();
  for (const r of rows) {
    const key = `${r.signalId}|${r.direction}|${r.dayKind}|${r.hour === 24 ? 'day' : r.hour}`;
    byKey.set(key, r);
  }
  return (signalId: string, direction: string, dayKind: number, hour: number): LightTiming | null => {
    const r =
      byKey.get(`${signalId}|${direction}|${dayKind}|${hour}`) ??
      byKey.get(`${signalId}|${direction}|${dayKind}|day`) ??
      byKey.get(`${signalId}|*|${dayKind}|day`);
    return r ? toTiming(r, utcOffset) : null;
  };
}

function toTiming(r: Omit<TimingRow, 'signalId' | 'direction' | 'dayKind' | 'hour' | 'passes'>, utcOffset: number): LightTiming {
  return {
    stopChance: r.stopChance,
    waitS: r.waitS,
    waits: r.waits,
    ...(r.cycle ? { cycle: { ...r.cycle, utcOffsetS: utcOffset } } : {}),
  };
}

/**
 * How well older passes predict the newest: each pass in the last CHECK_DAYS is predicted red or
 * green from timings built without them, just as a route would be when the lights are just ahead.
 */
export function backTest(old: readonly ModelPass[], recent: readonly ModelPass[]): { checked: number; correct: number } {
  const timingFor = resolver(buildTimings(old), 0);
  let checked = 0;
  let correct = 0;
  for (const p of recent) {
    const t = timingFor(p.signalId, p.direction, p.dayKind, p.hour);
    if (!t) continue;
    checked++;
    // Local seconds as the clock, with no offset, as the cycle's offset is in local seconds too.
    const predicted = predictLight(t, (p.localDay * 86_400 + p.arriveS) * 1000, 0);
    if ((predicted.state === 'red') === p.stopped) correct++;
  }
  return { checked, correct };
}

/**
 * Rebuild every set of lights' timings from the passes that still stand: not a trip deleted or since
 * marked as a walk, nor a deleted or disabled account's. Passes older than PASS_DAYS are dropped.
 * Also says how well the timings predict the last CHECK_DAYS, built without them.
 */
export async function rebuildLightTimings(
  db: DbClient,
): Promise<{ lights: number; cycles: number; checked: number; correct: number; pruned: number }> {
  const pruned = await db.query(`DELETE FROM signal_passes WHERE observed_at < now() - make_interval(days => $1)`, [PASS_DAYS]);
  const r = await db.query<{
    signal_id: string;
    direction: string;
    day_kind: number;
    hour: number;
    user_id: string;
    stopped: boolean;
    wait_s: number;
    local_day: number;
    arrive_s: number;
    green_s: number | null;
    recent: boolean;
  }>(
    `SELECT p.signal_id::text, p.direction, p.day_kind, p.hour, t.user_id, p.stopped, p.wait_s, p.local_day, p.arrive_s, p.green_s,
            p.observed_at > now() - make_interval(days => $1) AS recent
     FROM signal_passes p
     JOIN trips t ON t.id = p.trip_id AND t.deleted_at IS NULL AND t.mode = 'car'
     JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND NOT u.test_account`,
    [CHECK_DAYS],
  );
  const passes = r.rows.map((x) => ({
    pass: {
      signalId: x.signal_id,
      direction: x.direction,
      dayKind: Number(x.day_kind),
      hour: Number(x.hour),
      userId: x.user_id,
      stopped: x.stopped,
      waitS: Number(x.wait_s),
      localDay: Number(x.local_day),
      arriveS: Number(x.arrive_s),
      greenS: x.green_s === null ? null : Number(x.green_s),
    },
    recent: x.recent,
  }));
  const check = backTest(passes.filter((p) => !p.recent).map((p) => p.pass), passes.filter((p) => p.recent).map((p) => p.pass));
  const rows = buildTimings(passes.map((p) => p.pass));
  await db.query('DELETE FROM signal_timings');
  if (rows.length) {
    await db.query(
      `INSERT INTO signal_timings (signal_id, direction, day_kind, hour, stop_chance, wait_s, waits, passes, cycle_s, green_s, offset_s)
       SELECT signal_id, direction, day_kind, hour, stop_chance, wait_s, waits, passes, cycle_s, green_s, offset_s
       FROM json_to_recordset($1::json) AS x(signal_id bigint, direction text, day_kind smallint, hour smallint, stop_chance real, wait_s real,
                                             waits real[], passes int, cycle_s real, green_s real, offset_s real)`,
      [
        JSON.stringify(
          rows.map((x) => ({
            signal_id: x.signalId,
            direction: x.direction,
            day_kind: x.dayKind,
            hour: x.hour,
            stop_chance: x.stopChance,
            wait_s: x.waitS,
            waits: x.waits,
            passes: x.passes,
            cycle_s: x.cycle?.cycleS ?? null,
            green_s: x.cycle?.greenS ?? null,
            offset_s: x.cycle?.offsetS ?? null,
          })),
        ),
      ],
    );
  }
  return {
    lights: new Set(rows.map((x) => x.signalId)).size,
    cycles: rows.filter((x) => x.cycle).length,
    ...check,
    pruned: pruned.rowCount ?? 0,
  };
}

/** Looks up a set of lights' timing going one way, for routes starting now. */
export type TimingLookup = (signalId: string, direction: string) => LightTiming | null;

export const NO_TIMINGS: TimingLookup = () => null;

/** The timings of the lights inside a box, for routes setting off now from `start`. */
export async function lightTimingsIn(db: DbClient, box: BBox, now: Date, start: LngLat): Promise<TimingLookup> {
  const tz = timeZoneAt(start);
  const { day, hour } = localDayHour(now, tz);
  const dayKind = dayKindOf(day);
  const r = await db.query<{
    signal_id: string;
    direction: string;
    hour: number;
    stop_chance: number;
    wait_s: number;
    waits: number[];
    passes: number;
    cycle_s: number | null;
    green_s: number | null;
    offset_s: number | null;
  }>(
    `SELECT st.signal_id::text, st.direction, st.hour, st.stop_chance, st.wait_s, st.waits, st.passes, st.cycle_s, st.green_s, st.offset_s
     FROM signal_timings st JOIN traffic_signals s ON s.id = st.signal_id
     WHERE point(s.lon, s.lat) <@ box(point($1, $2), point($3, $4)) AND st.day_kind = $5 AND st.hour IN ($6, 24)`,
    [box[0], box[1], box[2], box[3], dayKind, hour],
  );
  if (r.rows.length === 0) return NO_TIMINGS;
  const rows: TimingRow[] = r.rows.map((x) => ({
    signalId: x.signal_id,
    direction: x.direction,
    dayKind,
    hour: Number(x.hour),
    passes: Number(x.passes),
    stopChance: Number(x.stop_chance),
    waitS: Number(x.wait_s),
    waits: (x.waits ?? []).map(Number),
    cycle: x.cycle_s !== null && x.green_s !== null && x.offset_s !== null ? { cycleS: Number(x.cycle_s), greenS: Number(x.green_s), offsetS: Number(x.offset_s) } : null,
  }));
  const timingFor = resolver(rows, utcOffsetS(now, tz));
  return (signalId, direction) => timingFor(signalId, direction, dayKind, hour);
}
