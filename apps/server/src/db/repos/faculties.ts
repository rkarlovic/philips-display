import type { Faculty } from '@slidecast/shared';
import type { Db } from '../index.js';
import { scopeWhere, type FacultyScope } from '../../authz/index.js';

interface FacultyRow {
  id: number;
  name: string;
  storage_quota_mb: number | null;
  created_at: string;
  user_count: number;
}

const toFaculty = (r: FacultyRow): Faculty => ({
  id: r.id,
  name: r.name,
  storageQuotaMb: r.storage_quota_mb,
  userCount: r.user_count,
  createdAt: r.created_at,
});

const SELECT = `SELECT f.id, f.name, f.storage_quota_mb, f.created_at,
  (SELECT COUNT(*) FROM users u WHERE u.faculty_id = f.id AND u.active = 1) AS user_count
  FROM faculties f`;

export function listFaculties(db: Db, scope: FacultyScope): Faculty[] {
  const w = scopeWhere(scope, 'f.id');
  const rows = db
    .prepare(`${SELECT} WHERE ${w.sql} ORDER BY f.name COLLATE NOCASE`)
    .all(...w.params) as FacultyRow[];
  return rows.map(toFaculty);
}

export function getFaculty(db: Db, scope: FacultyScope, id: number): Faculty | undefined {
  const w = scopeWhere(scope, 'f.id');
  const row = db.prepare(`${SELECT} WHERE f.id = ? AND ${w.sql}`).get(id, ...w.params) as
    FacultyRow | undefined;
  return row && toFaculty(row);
}

export function facultyNameExists(db: Db, name: string, exceptId?: number): boolean {
  const row = db
    .prepare('SELECT id FROM faculties WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, exceptId ?? -1);
  return row !== undefined;
}

export function insertFaculty(
  db: Db,
  input: { name: string; storageQuotaMb: number | null },
): number {
  const res = db
    .prepare('INSERT INTO faculties (name, storage_quota_mb) VALUES (?, ?)')
    .run(input.name, input.storageQuotaMb);
  return Number(res.lastInsertRowid);
}

export function updateFaculty(
  db: Db,
  id: number,
  input: { name?: string; storageQuotaMb?: number | null },
): void {
  db.prepare(
    `UPDATE faculties SET
       name = COALESCE(?, name),
       storage_quota_mb = CASE WHEN ? THEN ? ELSE storage_quota_mb END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    input.name ?? null,
    input.storageQuotaMb !== undefined ? 1 : 0,
    input.storageQuotaMb ?? null,
    id,
  );
}

export function countFacultyUsers(db: Db, id: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users WHERE faculty_id = ?').get(id) as {
    n: number;
  };
  return row.n;
}

export function deleteFaculty(db: Db, id: number): void {
  db.prepare('DELETE FROM faculties WHERE id = ?').run(id);
}
