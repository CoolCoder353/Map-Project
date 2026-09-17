import type { DbClient } from '../db/pool.js';

/** Strip anything that looks like a coordinate, email or token from error text. */
export function scrubErrorText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/-?\d{1,3}\.\d{3,}/g, '[num]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .slice(0, 4000);
}

export interface ErrorEventInput {
  service: string;
  source: string;
  error: unknown;
  requestId?: string | null;
  userId?: string | null;
}

export async function recordErrorEvent(db: DbClient, e: ErrorEventInput): Promise<void> {
  const err = e.error instanceof Error ? e.error : new Error(String(e.error));
  await db.query(
    `INSERT INTO error_events (service, source, message, stack, request_id, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      e.service,
      e.source,
      scrubErrorText(err.message || err.name),
      err.stack ? scrubErrorText(err.stack) : null,
      e.requestId ?? null,
      e.userId ?? null,
    ],
  );
}
