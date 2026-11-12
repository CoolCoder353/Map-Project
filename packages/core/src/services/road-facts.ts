import OpeningHours from 'opening_hours';
import {
  type BBox,
  type MappedSignal,
  type Mode,
  type Route,
  type RouteSignal,
  type SignalKind,
  type SurveyedSign,
  type WayLanes,
  applyWayLimitRules,
  bboxOf,
  cumulativeM,
  directionAt,
  mainRoadEstimates,
  markTurnsAtLights,
  signalsAlongRoute,
  speedLimitRuns,
  splitEstimatedLimits,
  stateTimeZone,
  surveyedEstimates,
  timeZoneAt,
  travelTime,
  usuallySlow,
  withLanes,
  withoutCovered,
} from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import type { GhPath } from '../lib/graphhopper.js';
import { wallClock } from '../lib/hours.js';
import { learnedSpeeds } from './road-speeds.js';
import { NO_TIMINGS, type TimingLookup, lightTimingsIn } from './light-timing.js';

export interface WayRule {
  conditional: string | null;
  variable: boolean;
  state: string | null;
}

/** What the database knows about the roads some routes use. */
export interface RoadFacts {
  signals: MappedSignal[];
  rules: Map<number, WayRule>;
  /** Typical km/h on a way at the time the routes start, where enough trips have driven it then. */
  speeds: Map<number, number>;
  /** How long a set of lights usually holds a car going one way through it now, where drives have shown it. */
  timings: TimingLookup;
  /** The lane markings on the roads that have them (driving only). */
  lanes: Map<number, WayLanes>;
  /** Surveyed speed limit signs near the routes (driving only), for stretches the map has no limit for. */
  speedSigns: SurveyedSign[];
}

export const NO_ROAD_FACTS: RoadFacts = { signals: [], rules: new Map(), speeds: new Map(), timings: NO_TIMINGS, lanes: new Map(), speedSigns: [] };

/** The surveyed speed limit signs inside a box. */
export async function speedSignsIn(db: DbClient, box: BBox, limit = 50_000): Promise<SurveyedSign[]> {
  const r = await db.query<{ lon: number; lat: number; kmh: number; bearing: number }>(
    `SELECT lon, lat, kmh, bearing FROM speed_signs WHERE point(lon, lat) <@ box(point($1, $2), point($3, $4)) LIMIT $5`,
    [box[0], box[1], box[2], box[3], limit],
  );
  return r.rows.map((x) => ({ lon: x.lon, lat: x.lat, kmh: Number(x.kmh), bearing: Number(x.bearing) }));
}

/** The lane markings on these ways, where mapped. */
export async function lanesOf(db: DbClient, wayIds: readonly number[]): Promise<Map<number, WayLanes>> {
  if (wayIds.length === 0) return new Map();
  const r = await db.query<{ way_id: string; forward: string | null; backward: string | null; coords: WayLanes['coords'] }>(
    'SELECT way_id::text, forward, backward, coords FROM way_lanes WHERE way_id = ANY($1::bigint[])',
    [wayIds.map(String)],
  );
  return new Map(r.rows.map((x) => [Number(x.way_id), { forward: x.forward, backward: x.backward, coords: x.coords }]));
}

const wayIdsOf = (paths: readonly GhPath[]) => [...new Set(paths.flatMap((p) => (p.details?.osm_way_id ?? []).map((r) => r[2]).filter((id) => id > 0)))];

/** The traffic lights inside a box. */
export async function signalsIn(db: DbClient, box: BBox, limit = 50_000): Promise<Array<MappedSignal & { id: string }>> {
  const r = await db.query<{ id: string; lon: number; lat: number; kind: SignalKind }>(
    `SELECT id::text, lon, lat, kind FROM traffic_signals WHERE point(lon, lat) <@ box(point($1, $2), point($3, $4)) LIMIT $5`,
    [box[0], box[1], box[2], box[3], limit],
  );
  return r.rows;
}

/** Load the lights, limit rules and learned speeds for the roads these routes use. */
export async function loadRoadFacts(db: DbClient, paths: readonly GhPath[], mode: Mode, now: Date): Promise<RoadFacts> {
  const coords = paths.flatMap((p) => p.points.coordinates);
  if (coords.length === 0) return NO_ROAD_FACTS;
  const ways = wayIdsOf(paths);
  const box = bboxOf(coords, 30);
  const [signals, rules, speeds, timings, lanes, speedSigns] = await Promise.all([
    // Lights are for driving: on foot they're crossings, which a walk's time already allows for.
    mode === 'car' ? signalsIn(db, box) : Promise.resolve([]),
    ways.length
      ? db
          .query<{ way_id: string; conditional: string | null; variable: boolean; state: string | null }>(
            'SELECT way_id::text, conditional, variable, state FROM way_speed_rules WHERE way_id = ANY($1::bigint[])',
            [ways.map(String)],
          )
          .then((r) => new Map(r.rows.map((x) => [Number(x.way_id), { conditional: x.conditional, variable: x.variable, state: x.state }])))
      : Promise.resolve(new Map<number, WayRule>()),
    mode === 'car' ? learnedSpeeds(db, ways, now, coords[0]!) : Promise.resolve(new Map<number, number>()),
    mode === 'car' ? lightTimingsIn(db, box, now, coords[0]!) : Promise.resolve(NO_TIMINGS),
    mode === 'car' ? lanesOf(db, ways) : Promise.resolve(new Map<number, WayLanes>()),
    mode === 'car' ? speedSignsIn(db, box) : Promise.resolve([]),
  ]);
  return { signals, rules, speeds, timings, lanes, speedSigns };
}

const parsedConditions = new Map<string, OpeningHours | null>();

function condition(spec: string): OpeningHours | null {
  if (parsedConditions.has(spec)) return parsedConditions.get(spec)!;
  let oh: OpeningHours | null;
  // School and public holidays ("SH off; PH off") need holiday data the library doesn't have for
  // Australia, so they're dropped: the zone then applies on holidays too, the cautious way to be wrong.
  const days = spec.replace(/;?\s*\b(SH|PH)\s+off\b/g, '').replace(/^[;\s]+|[;\s]+$/g, '');
  try {
    oh = days ? new OpeningHours(days, { lat: -27.47, lon: 153.03, address: { country_code: 'au', state: '' } }, 0) : null;
  } catch {
    oh = null;
  }
  if (parsedConditions.size > 5000) parsedConditions.clear();
  parsedConditions.set(spec, oh);
  return oh;
}

/** Split an OSM conditional at its top-level semicolons (the ones outside brackets). */
function conditionalParts(tag: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tag.length; i++) {
    if (tag[i] === '(') depth++;
    else if (tag[i] === ')') depth = Math.max(0, depth - 1);
    else if (tag[i] === ';' && depth === 0) {
      parts.push(tag.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(tag.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * The limit an OSM `maxspeed:conditional` sets now, or null when none of its conditions holds (or it
 * can't be read): "40 @ (Mo-Fr 07:00-09:00,14:00-16:00)" is 40 on a weekday morning, null at noon.
 * Only times and days are understood; conditions on vehicles or weather are ignored.
 */
export function conditionalLimitNow(tag: string, timeZone: string, now: Date): number | null {
  for (const part of conditionalParts(tag)) {
    const m = /^(\d{1,3})\s*@\s*\(?(.+?)\)?$/.exec(part);
    if (!m) continue;
    const kmh = Number(m[1]);
    if (!(kmh > 0 && kmh <= 130)) continue;
    const oh = condition(m[2]!.trim());
    if (!oh) continue;
    try {
      if (oh.getState(wallClock(now, timeZone))) return kmh;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Finish a route with what the database knows about its roads: lights (driving only) and turns made
 * at them, the lanes for each turn where they're mapped, signposted limits apart from estimated ones, school zones in force and roads whose limit
 * is on electronic signs, the time the drive takes going by trips actually made, and how long each
 * set of lights usually holds a car going this way at this time.
 */
export function finishRoute(route: Route, path: GhPath, facts: RoadFacts, now: Date): Route {
  const coords = path.points.coordinates;
  const ways = path.details?.osm_way_id ?? [];
  const startZone = coords[0] ? timeZoneAt(coords[0]) : stateTimeZone(null);

  // Limits: the engine's, split into signposted and estimated, then the roads' own rules on top.
  const split = splitEstimatedLimits(path.details?.max_speed ?? [], path.details?.max_speed_estimated ?? []);
  const { signed } = split;
  // On a highway, the same road's signs beat the built-up default (or no limit beats a wrong one).
  const d = path.details;
  // And where a surveyed sign on the same road says what the limit is, that beats a guess.
  const estimated = surveyedEstimates(
    mainRoadEstimates(split.estimated, signed, d?.road_class ?? [], d?.street_name ?? [], d?.street_ref ?? [], coords),
    coords,
    facts.speedSigns,
    d?.street_name ?? [],
  );
  const ruleFor = (wayId: number) => {
    const rule = facts.rules.get(wayId);
    if (!rule) return null;
    if (rule.variable) return 'variable' as const;
    const kmh = rule.conditional ? conditionalLimitNow(rule.conditional, rule.state ? stateTimeZone(rule.state) : startZone, now) : null;
    return kmh === null ? null : { kmh };
  };
  const speedLimits = speedLimitRuns(coords, applyWayLimitRules(signed, ways, ruleFor));
  const estimatedSpeedLimits = withoutCovered(speedLimitRuns(coords, applyWayLimitRules(estimated, ways, ruleFor)), speedLimits);

  // Lights, ignoring any beside a bridge or tunnel (the junction under or over it).
  const environment = path.details?.road_environment ?? [];
  const offTheGround = (segment: number) => environment.some(([from, to, env]) => from <= segment && segment < to && (env === 'bridge' || env === 'tunnel'));
  const cum = cumulativeM(coords);
  // Each set with how long it usually holds a car going the way this route goes through it.
  const signals: RouteSignal[] = (route.mode === 'car' ? signalsAlongRoute(coords, facts.signals, offTheGround) : []).map((s) => {
    const direction = s.id ? directionAt(coords, cum, cum[s.index]!) : null;
    const timing = s.id && direction ? facts.timings(s.id, direction) : null;
    return timing ? { ...s, timing } : s;
  });

  // Turns with the lanes to be in, where the road leading to them has its lanes mapped.
  const atLights = markTurnsAtLights(route.instructions, coords, signals);
  const instructions = route.mode === 'car' ? withLanes(atLights, coords, ways, (id) => facts.lanes.get(id)) : atLights;
  const time = travelTime({
    coords,
    instructions,
    timeRuns: path.details?.time ?? null,
    wayRuns: ways,
    learned: (id) => facts.speeds.get(id) ?? null,
    signals,
  });
  const slow = usuallySlow(time, path.time / 1000);
  return {
    ...route,
    durationS: time.totalS,
    instructions: instructions.map((ins, i) => ({ ...ins, durationS: time.instructionS[i] ?? ins.durationS })),
    speedLimits,
    ...(estimatedSpeedLimits.length ? { estimatedSpeedLimits } : {}),
    ...(signals.length ? { trafficSignals: signals } : {}),
    ...(slow ? { usuallySlow: true } : {}),
  };
}

/** Finish several routes from one load of road facts. */
export async function finishRoutes(db: DbClient, items: ReadonlyArray<{ route: Route; path: GhPath }>, now = new Date()): Promise<Route[]> {
  if (items.length === 0) return [];
  const facts = await loadRoadFacts(db, items.map((i) => i.path), items[0]!.route.mode, now);
  return items.map(({ route, path }) => finishRoute(route, path, facts, now));
}
