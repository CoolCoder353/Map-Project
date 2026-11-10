import { z } from 'zod';
import { LngLatSchema, ModeSchema } from './common.js';

export const TrackSourceSchema = z.enum(['background', 'navigation']);
export type TrackSource = z.infer<typeof TrackSourceSchema>;

export const TrackPointInputSchema = z.object({
  /** Epoch milliseconds */
  ts: z.number().int().positive(),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  accuracyM: z.number().min(0).max(10_000).nullable().optional(),
  speedMps: z.number().min(0).max(200).nullable().optional(),
  headingDeg: z.number().min(0).max(360).nullable().optional(),
});

export const TrackBatchRequestSchema = z.object({
  batchId: z.uuid(),
  source: TrackSourceSchema,
  /** Set when recorded during navigation; the mode is then known. */
  mode: ModeSchema.optional(),
  navigationSessionId: z.uuid().optional(),
  /** Where a navigated trip is going, as the app names it ("Woolworths"). */
  destinationName: z.string().trim().min(1).max(200).optional(),
  points: z.array(TrackPointInputSchema).min(1).max(5000),
});
export type TrackBatchRequest = z.infer<typeof TrackBatchRequestSchema>;

export const TrackBatchResponseSchema = z.object({
  accepted: z.number().int(),
  duplicate: z.boolean(),
});

export const TripSummarySchema = z.object({
  id: z.string(),
  mode: ModeSchema,
  source: TrackSourceSchema,
  startedAt: z.string(),
  endedAt: z.string(),
  distanceM: z.number(),
  /** Roads this trip was the first to travel. */
  newRoads: z.number().int(),
  /** The place nearest where it ended ("Coot-tha Place"), to tell trips apart (P33). Absent from older servers, or where nothing is known. */
  endedNear: z.string().nullable().optional(),
  /** Where a trip with directions was going ("Woolworths"). Absent from older servers and trips. */
  destinationName: z.string().nullable().optional(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;

export const TripListResponseSchema = z.object({
  items: z.array(TripSummarySchema),
  nextCursor: z.string().nullable(),
});

export const TripDetailSchema = TripSummarySchema.extend({
  geometry: z.array(LngLatSchema),
  points: z.array(z.object({ ts: z.number(), lon: z.number(), lat: z.number() })),
  /** The trip snapped onto the roads it took, where it could be; absent off-road or before matching. */
  matchedGeometry: z.array(LngLatSchema).optional(),
  /** The roads this trip was the first to travel, each stretch a line. Absent from older servers. */
  newRoadLines: z.array(z.array(LngLatSchema)).optional(),
});
export type TripDetail = z.infer<typeof TripDetailSchema>;

export const UpdateTripSchema = z.object({ mode: ModeSchema });
