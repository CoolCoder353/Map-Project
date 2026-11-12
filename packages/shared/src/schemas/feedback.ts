import { z } from 'zod';
import { LngLatSchema } from './common.js';

export const FeedbackTypeSchema = z.enum(['bug', 'idea', 'other', 'speed_limit']);
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
export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = { bug: 'Bug', idea: 'Idea', other: 'Other', speed_limit: 'Speed limit' };

/** Collected automatically; the map view only when the user ticks the box. */
export const FeedbackContextSchema = z.object({
  screen: z.string().max(300),
  platform: z.enum(['web', 'android']),
  appVersion: z.string().max(40),
  device: z.string().max(400),
  mapView: z.object({ center: LngLatSchema, zoom: z.number().min(0).max(24) }).optional(),
});
export type FeedbackContext = z.infer<typeof FeedbackContextSchema>;

/** A wrong speed limit, reported from where it was shown. */
export const SpeedLimitReportSchema = z.object({
  location: LngLatSchema,
  /** Which way the driver was going, degrees clockwise from north, when known. */
  headingDeg: z.number().min(0).max(360).optional(),
  /** The limit shown, or null when none was. */
  shownKmh: z.number().int().positive().max(130).nullable(),
  /** Whether the limit shown was an estimate rather than a signposted one. */
  estimated: z.boolean().optional(),
  /** The limit on the sign, when the driver says. */
  signedKmh: z.number().int().positive().max(130).optional(),
});
export type SpeedLimitReport = z.infer<typeof SpeedLimitReportSchema>;

export const FEEDBACK_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

export const FeedbackScreenshotSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** base64, no data: prefix */
  data: z.string().max(Math.ceil((FEEDBACK_SCREENSHOT_MAX_BYTES * 4) / 3) + 4),
});

export const FeedbackCreateSchema = z.object({
  type: FeedbackTypeSchema,
  message: z.string().trim().min(3, 'Tell us a little more').max(4000),
  context: FeedbackContextSchema,
  screenshot: FeedbackScreenshotSchema.optional(),
  /** Only with type speed_limit, which needs it. */
  speedLimit: SpeedLimitReportSchema.optional(),
}).refine((v) => (v.type === 'speed_limit') === (v.speedLimit !== undefined), { message: 'A speed limit report needs where it was', path: ['speedLimit'] });
export type FeedbackCreate = z.infer<typeof FeedbackCreateSchema>;

export const FeedbackItemSchema = z.object({
  id: z.string(),
  type: FeedbackTypeSchema,
  status: FeedbackStatusSchema,
  message: z.string(),
  context: FeedbackContextSchema,
  hasScreenshot: z.boolean(),
  speedLimit: SpeedLimitReportSchema.optional(),
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

/** The screen Android Auto's one-tap Report says it came from. */
export const CAR_REPORT_SCREEN = 'Android Auto: driving';
/** How long after a report from the car the driver can still add what was wrong. */
export const CAR_REPORT_DAYS = 7;

/** One of your own reports from the car, to add details to once it's safe. */
export const CarReportSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** The direction the car was showing, when there was one. */
  showing: z.string().nullable(),
  detailsAdded: z.boolean(),
});
export type CarReport = z.infer<typeof CarReportSchema>;
export const CarReportListSchema = z.object({ reports: z.array(CarReportSchema) });

/** What was wrong, added to a report sent from the car with one tap. */
export const CarReportDetailsSchema = z.object({
  message: z.string().trim().min(3, 'Tell us a little more').max(4000),
  screenshot: FeedbackScreenshotSchema.optional(),
});
export type CarReportDetails = z.infer<typeof CarReportDetailsSchema>;

/**
 * A road whose speed limit the group's drives suggest is wrong: they typically go well over it, or
 * well under it on a fast road. Rebuilt nightly, for an admin to check and correct in OpenStreetMap.
 */
export const LimitCheckSchema = z.object({
  wayId: z.string(),
  /** The limit the map gives the road. */
  limitKmh: z.number(),
  /** How fast drives typically go along it. */
  typicalKmh: z.number(),
  trips: z.number().int(),
  people: z.number().int(),
  /** Roughly the middle of the stretches timed. */
  location: z.tuple([z.number(), z.number()]),
});
export type LimitCheck = z.infer<typeof LimitCheckSchema>;
export const LimitCheckListSchema = z.object({ items: z.array(LimitCheckSchema) });
