import {
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  type FeedbackContext,
  type FeedbackCreate,
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackType,
} from '@wayfinder/shared';
import type { DbClient } from '../db/pool.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { getAppSettings } from './app-settings.js';

export const REPORTS_PER_HOUR = 5;

interface FeedbackRow {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  message: string;
  context: FeedbackContext;
  has_screenshot: boolean;
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
  adminNotes: r.admin_notes,
  user: r.user_id && r.email ? { id: r.user_id, email: r.email } : null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = `SELECT f.id, f.type, f.status, f.message, f.context, f.screenshot IS NOT NULL AS has_screenshot,
                       f.admin_notes, f.user_id, u.email, f.created_at, f.updated_at
                FROM feedback f LEFT JOIN users u ON u.id = f.user_id`;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

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
  let image: Buffer | null = null;
  if (input.screenshot) {
    image = Buffer.from(input.screenshot.data, 'base64');
    if (image.length === 0 || image.length > FEEDBACK_SCREENSHOT_MAX_BYTES) throw badRequest('The screenshot must be under 2 MB');
    if (!MAGIC[input.screenshot.mediaType]!(image)) throw badRequest('The screenshot isn’t a JPEG, PNG or WebP image');
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO feedback (user_id, type, message, context, screenshot, screenshot_type)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, input.type, input.message, JSON.stringify(input.context), image, image ? input.screenshot!.mediaType : null],
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
