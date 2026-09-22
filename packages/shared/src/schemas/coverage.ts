import { z } from 'zod';
import { BBoxQuerySchema } from './common.js';

export const CoverageQuerySchema = z.object({
  bbox: BBoxQuerySchema,
  zoom: z.coerce.number().min(0).max(24),
  /** "geojson" returns the roads as a FeatureCollection, ready for a map layer. */
  format: z.enum(['roads', 'geojson']).default('roads'),
});

export const CoveredRoadSchema = z.object({
  wayId: z.number(),
  /** The travelled part of the road, [[lon, lat], ...]. */
  geometry: z.array(z.tuple([z.number(), z.number()])),
  /** First travelled in the last 7 days. */
  recent: z.boolean(),
  /** bit 1 = car, bit 2 = foot */
  modes: z.number().int(),
});
export type CoveredRoad = z.infer<typeof CoveredRoadSchema>;

export const CoverageResponseSchema = z.object({
  roads: z.array(CoveredRoadSchema),
  truncated: z.boolean(),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

export const CoverageStatsSchema = z.object({
  /** Kilometres of road travelled at least once. */
  roadKm: z.number(),
  /** Number of distinct roads. */
  roadsTravelled: z.number().int(),
  newRoadsWeek: z.number().int(),
  newRoadsMonth: z.number().int(),
  byMode: z.object({ carKm: z.number(), footKm: z.number() }),
  firstVisitAt: z.string().nullable(),
  tripCount: z.number().int(),
  distanceKm: z.number(),
});
export type CoverageStats = z.infer<typeof CoverageStatsSchema>;
