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
  newCells: z.number().int(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;

export const TripListResponseSchema = z.object({
  items: z.array(TripSummarySchema),
  nextCursor: z.string().nullable(),
});

export const TripDetailSchema = TripSummarySchema.extend({
  geometry: z.array(LngLatSchema),
  points: z.array(z.object({ ts: z.number(), lon: z.number(), lat: z.number() })),
});
export type TripDetail = z.infer<typeof TripDetailSchema>;

export const UpdateTripSchema = z.object({ mode: ModeSchema });
