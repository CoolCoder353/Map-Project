import { z } from 'zod';
import { LngLatSchema } from './common.js';

export const FeedbackTypeSchema = z.enum(['bug', 'idea', 'other']);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

export const FeedbackStatusSchema = z.enum(['new', 'planned', 'in_progress', 'done', 'wont_fix']);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  wont_fix: 'Won’t fix',
};
export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = { bug: 'Bug', idea: 'Idea', other: 'Other' };

/** Collected automatically; the map view only when the user ticks the box. */
export const FeedbackContextSchema = z.object({
  screen: z.string().max(300),
  platform: z.enum(['web', 'android']),
  appVersion: z.string().max(40),
  device: z.string().max(400),
  mapView: z.object({ center: LngLatSchema, zoom: z.number().min(0).max(24) }).optional(),
});
export type FeedbackContext = z.infer<typeof FeedbackContextSchema>;

export const FEEDBACK_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

export const FeedbackCreateSchema = z.object({
  type: FeedbackTypeSchema,
  message: z.string().trim().min(3, 'Tell us a little more').max(4000),
  context: FeedbackContextSchema,
  screenshot: z
    .object({
      mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      /** base64, no data: prefix */
      data: z.string().max(Math.ceil((FEEDBACK_SCREENSHOT_MAX_BYTES * 4) / 3) + 4),
    })
    .optional(),
});
export type FeedbackCreate = z.infer<typeof FeedbackCreateSchema>;

export const FeedbackItemSchema = z.object({
  id: z.string(),
  type: FeedbackTypeSchema,
  status: FeedbackStatusSchema,
  message: z.string(),
  context: FeedbackContextSchema,
  hasScreenshot: z.boolean(),
  adminNotes: z.string(),
  user: z.object({ id: z.string(), email: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;

export const FeedbackListQuerySchema = z.object({
  status: FeedbackStatusSchema.optional(),
  type: FeedbackTypeSchema.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const FeedbackUpdateSchema = z
  .object({ status: FeedbackStatusSchema.optional(), adminNotes: z.string().max(4000).optional() })
  .refine((v) => v.status !== undefined || v.adminNotes !== undefined, 'Nothing to update');
