import type { DbClient } from '../db/pool.js';

export interface AuditEntryInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Append an admin audit entry. Call with the same client as the action's transaction. */
export async function audit(db: DbClient, e: AuditEntryInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.actorId, e.action, e.targetType, e.targetId ?? null, JSON.stringify(e.details ?? {}), e.ip ?? null],
  );
}
