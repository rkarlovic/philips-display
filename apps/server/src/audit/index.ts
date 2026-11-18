import type { AuditEntry } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import type { SessionUser } from '../authz/index.js';

export interface AuditInput {
  action: string; // e.g. 'create', 'update', 'delete', 'login', 'logout'
  entity: string; // e.g. 'faculty', 'user', 'session'
  entityId?: string | number | null;
  facultyId?: number | null;
  details?: unknown;
}

/** Writes one audit row. Call inside the same transaction as the change it records. */
export function writeAudit(db: Db, actor: SessionUser | null, entry: AuditInput, now: Date): void {
  db.prepare(
    `INSERT INTO audit_log (at, user_id, faculty_id, action, entity, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    now.toISOString(),
    actor?.id ?? null,
    entry.facultyId ?? actor?.facultyId ?? null,
    entry.action,
    entry.entity,
    entry.entityId == null ? null : String(entry.entityId),
    entry.details === undefined ? null : JSON.stringify(entry.details),
  );
}

interface AuditRow {
  id: number;
  at: string;
  user_id: number | null;
  user_email: string | null;
  faculty_id: number | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details_json: string | null;
}

export function listAudit(db: Db, opts: { limit: number; facultyId?: number }): AuditEntry[] {
  const where = opts.facultyId ? 'WHERE a.faculty_id = ?' : '';
  const params: unknown[] = opts.facultyId ? [opts.facultyId] : [];
  const rows = db
    .prepare(
      `SELECT a.*, u.email AS user_email FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.id DESC LIMIT ?`,
    )
    .all(...params, opts.limit) as AuditRow[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    userId: r.user_id,
    userEmail: r.user_email,
    facultyId: r.faculty_id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    details: r.details_json ? JSON.parse(r.details_json) : null,
  }));
}
