import { z } from 'zod';
import { LngLatSchema, ModeSchema } from './common.js';

export const InstructionSchema = z.object({
  /** GraphHopper sign code: -3..3 turns, 4 finish, 5 via reached, 6 roundabout, ±7 keep, ±8 u-turn */
  sign: z.number().int(),
  text: z.string(),
  streetName: z.string(),
  distanceM: z.number(),
  durationS: z.number(),
  /** Index range into the route geometry this instruction covers. */
  interval: z.tuple([z.number().int(), z.number().int()]),
  exitNumber: z.number().int().optional(),
  /**
   * Roundabouts: how far round it the exit is, in degrees in the direction of travel (90 a left
   * turn on Queensland's clockwise roundabouts, 180 straight on, 270 right). Absent when unknown.
   */
  exitAngleDeg: z.number().min(1).max(360).optional(),
  /** The turn is at a set of traffic lights (its text then starts "At the lights"). */
  atTrafficLights: z.boolean().optional(),
});
export type Instruction = z.infer<typeof InstructionSchema>;

export const NoveltySchema = z.object({
  totalKm: z.number(),
  newKm: z.number(),
  noveltyPct: z.number(),
});

const SpeedLimitRunSchema = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), kmh: z.number().positive() });

export const RouteKindSchema = z.enum(['fastest', 'explore', 'roundtrip']);

export const LightTimingSchema = z.object({
  stopChance: z.number().min(0).max(1),
  waitS: z.number().nonnegative(),
  waits: z.array(z.number().nonnegative()).max(5),
  /** A fixed cycle, where its changes to green line up day after day: green from `offsetS` past local midnight, every `cycleS`, for `greenS`. */
  cycle: z.object({ cycleS: z.number().positive(), greenS: z.number().nonnegative(), offsetS: z.number(), utcOffsetS: z.number() }).optional(),
});

export const RouteSchema = z.object({
  id: z.string(),
  kind: RouteKindSchema,
  mode: ModeSchema,
  distanceM: z.number(),
  durationS: z.number(),
  /** Extra time compared with the fastest route (0 for fastest). */
  extraDurationS: z.number(),
  geometry: z.array(LngLatSchema),
  instructions: z.array(InstructionSchema),
  viaPoints: z.array(LngLatSchema),
  novelty: NoveltySchema,
  /**
   * Speed limits along the route: km/h from geometry point `from` to `to`. Stretches with no
   * limit mapped are missing. Absent from older servers.
   */
  speedLimits: z.array(SpeedLimitRunSchema).optional(),
  /**
   * Limits where none is signposted in the map data, estimated from the legal default for the kind
   * of road (50 in a built-up area, say). Kept apart so older apps, which show `speedLimits` as
   * signs, never show a guess as a sign. Absent from older servers.
   */
  estimatedSpeedLimits: z.array(SpeedLimitRunSchema).optional(),
  /** The sets of traffic lights along the route, at their nearest geometry point. Absent from older servers. */
  trafficSignals: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        kind: z.enum(['signals', 'crossing', 'ramp_meter']),
        /** The mapped light this set is known by. */
        id: z.string().optional(),
        /**
         * How long these lights usually hold a car going this way at this time, where enough drives
         * have shown it: for drawing them red or green ahead, and the wait while stopped there.
         */
        timing: LightTimingSchema.optional(),
      }),
    )
    .optional(),
  /** Trips on these roads at this time of day usually take noticeably longer than the map alone suggests. */
  usuallySlow: z.boolean().optional(),
});
export type Route = z.infer<typeof RouteSchema>;

export const FastestRouteRequestSchema = z.object({
  from: LngLatSchema,
  to: LngLatSchema,
  mode: ModeSchema,
  via: z.array(LngLatSchema).max(5).default([]),
  /**
   * Which way the traveller is heading, degrees clockwise from north. Sent with a new route asked
   * for mid-trip, so it starts the way they are going instead of turning them round.
   */
  heading: z.number().min(0).max(360).optional(),
  /** How fast they're going, metres a second, sent with [heading]: a turn too close to make at this speed is left out. */
  speedMps: z.number().min(0).max(100).optional(),
});
export type FastestRouteRequest = z.input<typeof FastestRouteRequestSchema>;

export const ExploreRouteRequestSchema = z.object({
  from: LngLatSchema,
  to: LngLatSchema,
  mode: ModeSchema,
  budgetMin: z.number().int().min(1).max(120).optional(),
});
export type ExploreRouteRequest = z.input<typeof ExploreRouteRequestSchema>;

export const ExploreRouteResponseSchema = z.object({
  fastest: RouteSchema,
  explore: z.array(RouteSchema),
});
export type ExploreRouteResponse = z.infer<typeof ExploreRouteResponseSchema>;

export const RoundTripRequestSchema = z.object({
  start: LngLatSchema,
  mode: ModeSchema,
  targetMin: z.number().int().min(10).max(600),
});
export type RoundTripRequest = z.input<typeof RoundTripRequestSchema>;

export const RoundTripResponseSchema = z.object({ routes: z.array(RouteSchema) });
export type RoundTripResponse = z.infer<typeof RoundTripResponseSchema>;

export const POI_CATEGORIES = [
  'viewpoint',
  'peak',
  'waterfall',
  'park',
  'beach',
  'attraction',
  'cafe',
  'historic',
  'trailhead',
  'museum',
  'picnic',
] as const;
export const PoiCategorySchema = z.enum(POI_CATEGORIES);
export type PoiCategory = z.infer<typeof PoiCategorySchema>;

/** One place of each kind, as a row says what it is: "Lookout", "Historic site". */
export const POI_KIND: Record<PoiCategory, string> = {
  viewpoint: 'Lookout', peak: 'Peak', waterfall: 'Waterfall', park: 'Park', beach: 'Beach', attraction: 'Attraction',
  cafe: 'Café', historic: 'Historic site', trailhead: 'Trailhead', museum: 'Museum', picnic: 'Picnic spot',
};
/** What kind of place it is. A newer server may send a category an older app doesn't know. */
export const poiKind = (category: string): string => POI_KIND[category as PoiCategory] ?? 'Place';

export const DiscoverQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  mode: ModeSchema,
  maxMinutes: z.coerce.number().int().min(5).max(240).default(30),
  categories: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(PoiCategorySchema).optional()),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DiscoverQuery = z.input<typeof DiscoverQuerySchema>;

export const DiscoverItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: PoiCategorySchema,
  location: LngLatSchema,
  distanceM: z.number(),
  areaUnexploredPct: z.number(),
  score: z.number(),
});
export type DiscoverItem = z.infer<typeof DiscoverItemSchema>;
export const DiscoverResponseSchema = z.object({ items: z.array(DiscoverItemSchema) });

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  lon: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export const PlaceHoursSchema = z.object({
  openNow: z.boolean(),
  /** e.g. "Open until 9 pm", "Closed · opens 7 am", "Open 24 hours" */
  label: z.string(),
});
export type PlaceHours = z.infer<typeof PlaceHoursSchema>;

export const PlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  /** typeLabel and context joined, for older app builds. */
  description: z.string(),
  location: LngLatSchema,
  /** "Supermarket", "Street", "Suburb" */
  typeLabel: z.string().optional(),
  /** "Dickson ACT 2602" */
  context: z.string().optional(),
  /** From the search origin, when one was given. */
  distanceM: z.number().optional(),
  hours: PlaceHoursSchema.optional(),
});
export type Place = z.infer<typeof PlaceSchema>;
export const SearchResponseSchema = z.object({ results: z.array(PlaceSchema) });
export const ReverseQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
});
export const ReverseResponseSchema = z.object({ place: PlaceSchema.nullable() });

export const PlannedRouteCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  route: RouteSchema,
});
export const PlannedRouteSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  route: RouteSchema,
});
export type PlannedRoute = z.infer<typeof PlannedRouteSchema>;
export const PlannedRouteListSchema = z.object({ items: z.array(PlannedRouteSchema) });

/** The limit on the road at a point, for driving with no trip (the car's map with no route). */
export const SpeedLimitQuerySchema = z.object({
  lon: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  /** Which way the car is going, degrees clockwise from north: picks the road and its side. */
  heading: z.coerce.number().min(0).max(360).optional(),
});
export type SpeedLimitQuery = z.input<typeof SpeedLimitQuerySchema>;

export const SpeedLimitResponseSchema = z.object({
  /** Null where no limit is known, or the point isn't on a road. */
  kmh: z.number().positive().nullable(),
  /** The legal default for the road, not a sign in the map data. */
  estimated: z.boolean(),
  /** The road's name, or null. */
  road: z.string().nullable(),
});
export type SpeedLimitResponse = z.infer<typeof SpeedLimitResponseSchema>;
