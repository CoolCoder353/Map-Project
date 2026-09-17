import { z } from 'zod';
import { BBoxQuerySchema } from './common.js';

export const CoverageQuerySchema = z.object({
  bbox: BBoxQuerySchema,
  zoom: z.coerce.number().min(0).max(24),
});

export const CoverageCellSchema = z.object({
  h3: z.string(),
  /** Share of VISIT_RES children visited (always 1 at VISIT_RES). */
  fraction: z.number().min(0).max(1),
});

export const CoverageResponseSchema = z.object({
  res: z.number().int(),
  cells: z.array(CoverageCellSchema),
  truncated: z.boolean(),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

export const CoverageStatsSchema = z.object({
  cellsVisited: z.number().int(),
  areaKm2: z.number(),
  newCellsWeek: z.number().int(),
  newCellsMonth: z.number().int(),
  byMode: z.object({ car: z.number().int(), foot: z.number().int() }),
  firstVisitAt: z.string().nullable(),
  tripCount: z.number().int(),
  distanceKm: z.number(),
});
export type CoverageStats = z.infer<typeof CoverageStatsSchema>;
