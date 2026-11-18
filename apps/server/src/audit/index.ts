import type { AuditPage } from '@slidecast/shared';
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

export interface AuditFilter {
  limit: number;
  facultyId?: number;
  userId?: number;
  entity?: string;
  action?: string;
  beforeId?: number;
}

/** Newest first, filtered; fetches one extra row to know whether there is more. */
export function listAudit(db: Db, f: AuditFilter): AuditPage {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    conds.push(sql);
    params.push(v);
  };
  if (f.facultyId) add('a.faculty_id = ?', f.facultyId);
  if (f.userId) add('a.user_id = ?', f.userId);
  if (f.entity) add('a.entity = ?', f.entity);
  if (f.action) add('a.action = ?', f.action);
  if (f.beforeId) add('a.id < ?', f.beforeId);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT a.*, u.email AS user_email, fa.name AS faculty_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN faculties fa ON fa.id = a.faculty_id
       ${where} ORDER BY a.id DESC LIMIT ?`,
    )
    .all(...params, f.limit + 1) as (AuditRow & { faculty_name: string | null })[];

  const more = rows.length > f.limit;
  const page = rows.slice(0, f.limit);
  const distinct = (col: 'entity' | 'action') =>
    (
      db.prepare(`SELECT DISTINCT ${col} AS v FROM audit_log ORDER BY v`).all() as { v: string }[]
    ).map((r) => r.v);
  return {
    entries: page.map((r) => ({
      id: r.id,
      at: r.at,
      userId: r.user_id,
      userEmail: r.user_email,
      facultyId: r.faculty_id,
      facultyName: r.faculty_name,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      details: r.details_json ? JSON.parse(r.details_json) : null,
    })),
    nextBeforeId: more ? page[page.length - 1]!.id : null,
    entities: distinct('entity'),
    actions: distinct('action'),
  };
}
