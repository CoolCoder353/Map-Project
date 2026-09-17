import { z } from 'zod';

export const ModeSchema = z.enum(['car', 'foot']);
export type Mode = z.infer<typeof ModeSchema>;

export const RoleSchema = z.enum(['user', 'dev', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const LngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const BBoxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([minLon, minLat, maxLon, maxLat]) => minLon <= maxLon && minLat <= maxLat, {
    message: 'bbox must be minLon,minLat,maxLon,maxLat',
  });

/** Parse "minLon,minLat,maxLon,maxLat" query strings. */
export const BBoxQuerySchema = z
  .string()
  .transform((s) => s.split(',').map(Number))
  .pipe(BBoxSchema);

export const UuidSchema = z.uuid();

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
