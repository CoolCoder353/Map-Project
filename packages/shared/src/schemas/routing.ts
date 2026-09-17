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
});
export type Instruction = z.infer<typeof InstructionSchema>;

export const NoveltySchema = z.object({
  totalKm: z.number(),
  newKm: z.number(),
  noveltyPct: z.number(),
});

export const RouteKindSchema = z.enum(['fastest', 'explore', 'roundtrip']);

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
});
export type Route = z.infer<typeof RouteSchema>;

export const FastestRouteRequestSchema = z.object({
  from: LngLatSchema,
  to: LngLatSchema,
  mode: ModeSchema,
  via: z.array(LngLatSchema).max(5).default([]),
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
export const PlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  description: z.string(),
  location: LngLatSchema,
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
