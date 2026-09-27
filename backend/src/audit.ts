import { getPool } from './db.js';

export interface AuditEventInput {
  actorUserId?: string | null;
  hospitalId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * Standing rule: audit everything staff does. Audit failures are logged but never
 * fail the request that was already committed (e.g. an invitation that was created).
 */
export async function recordAudit(input: AuditEventInput): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO audit_events (actor_user_id, hospital_id, entity_type, entity_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.actorUserId ?? null,
        input.hospitalId ?? null,
        input.entityType,
        input.entityId ?? null,
        input.action,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (error) {
    console.error('[audit] failed to record', input.action, error);
  }
}
