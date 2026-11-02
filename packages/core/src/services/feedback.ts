import {
  CAR_REPORT_DAYS,
  CAR_REPORT_SCREEN,
  type CarReport,
  type CarReportDetails,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  type FeedbackContext,
  type FeedbackCreate,
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackType,
  type SpeedLimitReport,
} from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { AppError, badRequest, isUuid, notFound } from '../lib/errors.js';
import { getAppSettings } from './app-settings.js';

export const REPORTS_PER_HOUR = 5;

interface FeedbackRow {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  message: string;
  context: FeedbackContext;
  has_screenshot: boolean;
  speed_limit: SpeedLimitReport | null;
  admin_notes: string;
  user_id: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

const toItem = (r: FeedbackRow): FeedbackItem => ({
  id: r.id,
  type: r.type,
  status: r.status,
  message: r.message,
  context: r.context,
  hasScreenshot: r.has_screenshot,
  ...(r.speed_limit ? { speedLimit: r.speed_limit } : {}),
  adminNotes: r.admin_notes,
  user: r.user_id && r.email ? { id: r.user_id, email: r.email } : null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = `SELECT f.id, f.type, f.status, f.message, f.context, f.screenshot IS NOT NULL AS has_screenshot,
                       f.speed_limit, f.admin_notes, f.user_id, u.email, f.created_at, f.updated_at
                FROM feedback f LEFT JOIN users u ON u.id = f.user_id`;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};


/** A screenshot's bytes, checked to be an image of a sensible size. */
function screenshotBytes(shot: FeedbackCreate['screenshot']): Buffer | null {
  if (!shot) return null;
  const image = Buffer.from(shot.data, 'base64');
  if (image.length === 0 || image.length > FEEDBACK_SCREENSHOT_MAX_BYTES) throw badRequest('The screenshot must be under 2 MB');
  if (!MAGIC[shot.mediaType]!(image)) throw badRequest('The screenshot isn’t a JPEG, PNG or WebP image');
  return image;
}

/** A user's report. Rejected when feedback is switched off, too frequent, or the image isn't one. */
export async function createFeedback(db: DbClient, userId: string, input: FeedbackCreate): Promise<FeedbackItem> {
  if (!(await getAppSettings(db)).feedbackEnabled) throw new AppError(404, 'feedback_disabled', 'Feedback is turned off');
  const recent = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM feedback WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (Number(recent.rows[0]!.n) >= REPORTS_PER_HOUR) {
    throw new AppError(429, 'rate_limited', 'Thanks — that’s a lot of reports in an hour. Please try again later.');
  }
  const image = screenshotBytes(input.screenshot);
  const r = await db.query<{ id: string }>(
    `INSERT INTO feedback (user_id, type, message, context, screenshot, screenshot_type, speed_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      userId,
      input.type,
      input.message,
      JSON.stringify(input.context),
      image,
      image ? input.screenshot!.mediaType : null,
      input.speedLimit ? JSON.stringify(input.speedLimit) : null,
    ],
  );
  return (await getFeedback(db, r.rows[0]!.id))!;
}

export async function listFeedback(
  db: DbClient,
  q: { status?: FeedbackStatus | undefined; type?: FeedbackType | undefined; q?: string | undefined; limit: number },
): Promise<FeedbackItem[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.status) where.push(`f.status = $${args.push(q.status)}`);
  if (q.type) where.push(`f.type = $${args.push(q.type)}`);
  if (q.q) where.push(`(f.message ILIKE $${args.push(`%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)} OR u.email ILIKE $${args.length})`);
  const r = await db.query<FeedbackRow>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.created_at DESC LIMIT $${args.push(q.limit)}`,
    args,
  );
  return r.rows.map(toItem);
}

export async function getFeedback(db: DbClient, id: string): Promise<FeedbackItem | null> {
  if (!isUuid(id)) return null;
  const r = await db.query<FeedbackRow>(`${SELECT} WHERE f.id = $1`, [id]);
  return r.rows[0] ? toItem(r.rows[0]) : null;
}

export async function getScreenshot(db: DbClient, id: string): Promise<{ data: Buffer; mediaType: string }> {
  const r = isUuid(id)
    ? await db.query<{ screenshot: Buffer | null; screenshot_type: string | null }>('SELECT screenshot, screenshot_type FROM feedback WHERE id = $1', [id])
    : { rows: [] };
  const row = r.rows[0];
  if (!row?.screenshot || !row.screenshot_type) throw notFound('No screenshot');
  return { data: row.screenshot, mediaType: row.screenshot_type };
}

export async function updateFeedback(
  db: DbClient,
  id: string,
  patch: { status?: FeedbackStatus | undefined; adminNotes?: string | undefined },
): Promise<{ before: FeedbackItem; after: FeedbackItem }> {
  const before = await getFeedback(db, id);
  if (!before) throw notFound('Report not found');
  await db.query(
    `UPDATE feedback SET status = coalesce($2, status), admin_notes = coalesce($3, admin_notes), updated_at = now() WHERE id = $1`,
    [id, patch.status ?? null, patch.adminNotes ?? null],
  );
  return { before, after: (await getFeedback(db, id))! };
}

export async function deleteFeedback(db: DbClient, id: string): Promise<void> {
  const r = isUuid(id) ? await db.query('DELETE FROM feedback WHERE id = $1', [id]) : { rowCount: 0 };
  if (!r.rowCount) throw notFound('Report not found');
}

export async function countNewFeedback(db: DbClient): Promise<number> {
  return Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM feedback WHERE status = 'new'`)).rows[0]!.n);
}

/** Starts each lot of details added to a report from the car. */
export const DRIVER_DETAILS = 'Details from the driver';
/** Times details can be added to one report: enough to correct yourself, not a chat. */
export const MAX_DETAILS = 3;

/**
 * Your own reports from the car in the last CAR_REPORT_DAYS, newest first. The car's Report sends
 * what it showed with one tap and says the driver can explain later from Settings → Send feedback;
 * these are what they can explain.
 */
export async function carReports(db: DbClient, userId: string): Promise<CarReport[]> {
  const r = await db.query<{ id: string; message: string; created_at: Date }>(
    `SELECT id, message, created_at FROM feedback
     WHERE user_id = $1 AND context->>'screen' = $2 AND created_at > now() - make_interval(days => $3)
     ORDER BY created_at DESC LIMIT 20`,
    [userId, CAR_REPORT_SCREEN, CAR_REPORT_DAYS],
  );
  return r.rows.map((x) => ({
    id: x.id,
    createdAt: x.created_at.toISOString(),
    showing: /^Showing: "(.*)"/m.exec(x.message)?.[1] ?? null,
    detailsAdded: x.message.includes(DRIVER_DETAILS),
  }));
}

/**
 * Add what was wrong to one of your own reports from the car (and a screenshot, if it has none),
 * within CAR_REPORT_DAYS of sending it. Anyone else's report, or an older one, isn't found.
 */
export async function addCarReportDetails(db: DbClient, userId: string, id: string, input: CarReportDetails, now = new Date()): Promise<void> {
  if (!(await getAppSettings(db)).feedbackEnabled) throw new AppError(404, 'feedback_disabled', 'Feedback is turned off');
  if (!isUuid(id)) throw notFound('No such report from the car');
  const image = screenshotBytes(input.screenshot);
  const when = now.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });
  const yours = `id = $1 AND user_id = $2 AND context->>'screen' = $3 AND created_at > now() - make_interval(days => $4)`;
  // Checked and added in one statement, so requests at the same moment can't all pass the check.
  const added = await db.query(
    `UPDATE feedback SET message = message || $5, screenshot = coalesce(screenshot, $6), screenshot_type = coalesce(screenshot_type, $7), updated_at = now()
     WHERE ${yours} AND (length(message) - length(replace(message, $8, ''))) / length($8) < $9`,
    [id, userId, CAR_REPORT_SCREEN, CAR_REPORT_DAYS, `\n\n${DRIVER_DETAILS}, ${when}:\n${input.message}`, image, image ? input.screenshot!.mediaType : null, DRIVER_DETAILS, MAX_DETAILS],
  );
  if (added.rowCount) return;
  const found = await db.query(`SELECT 1 FROM feedback WHERE ${yours}`, [id, userId, CAR_REPORT_SCREEN, CAR_REPORT_DAYS]);
  if (!found.rowCount) throw notFound('No such report from the car');
  throw new AppError(429, 'rate_limited', 'That report already has all the details it can take. Send anything else as new feedback.');
}
