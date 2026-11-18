import type { Locale, Role, User } from '@slidecast/shared';
import type { Db } from '../index.js';
import { scopeWhere, type FacultyScope } from '../../authz/index.js';

export interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  faculty_id: number | null;
  faculty_name: string | null;
  locale: Locale;
  active: number;
  password_hash: string | null;
  created_at: string;
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  facultyId: r.faculty_id,
  facultyName: r.faculty_name,
  locale: r.locale,
  active: r.active === 1,
  createdAt: r.created_at,
});

const SELECT = `SELECT u.id, u.email, u.display_name, u.role, u.faculty_id, f.name AS faculty_name,
  u.locale, u.active, u.password_hash, u.created_at
  FROM users u LEFT JOIN faculties f ON f.id = u.faculty_id`;

/** Unscoped lookup used only by the auth layer (login, sessions). */
export function findUserByEmail(db: Db, email: string): UserRow | undefined {
  return db.prepare(`${SELECT} WHERE u.email = ?`).get(email.toLowerCase()) as UserRow | undefined;
}

/** Unscoped lookup used only by the auth layer. */
export function findUserById(db: Db, id: number): UserRow | undefined {
  return db.prepare(`${SELECT} WHERE u.id = ?`).get(id) as UserRow | undefined;
}

/** Faculty users visible in the given scope. */
export function listFacultyUsers(db: Db, scope: FacultyScope, facultyId?: number): User[] {
  const w = scopeWhere(scope, 'u.faculty_id');
  const extra = facultyId ? ' AND u.faculty_id = ?' : '';
  const params = facultyId ? [...w.params, facultyId] : w.params;
  const rows = db
    .prepare(
      `${SELECT} WHERE u.role = 'faculty_user' AND ${w.sql}${extra}
       ORDER BY f.name COLLATE NOCASE, u.email`,
    )
    .all(...params) as UserRow[];
  return rows.map(toUser);
}

export function getFacultyUser(db: Db, scope: FacultyScope, id: number): User | undefined {
  const w = scopeWhere(scope, 'u.faculty_id');
  const row = db
    .prepare(`${SELECT} WHERE u.id = ? AND u.role = 'faculty_user' AND ${w.sql}`)
    .get(id, ...w.params) as UserRow | undefined;
  return row && toUser(row);
}

export function insertFacultyUser(
  db: Db,
  input: { email: string; displayName: string; facultyId: number; locale: Locale },
): number {
  const res = db
    .prepare(
      `INSERT INTO users (email, display_name, role, faculty_id, locale, auth_provider)
       VALUES (?, ?, 'faculty_user', ?, ?, 'email')`,
    )
    .run(input.email.toLowerCase(), input.displayName, input.facultyId, input.locale);
  return Number(res.lastInsertRowid);
}

export function updateUser(
  db: Db,
  id: number,
  input: {
    email?: string;
    displayName?: string;
    facultyId?: number;
    locale?: Locale;
    active?: boolean;
  },
): void {
  db.prepare(
    `UPDATE users SET
       email = COALESCE(?, email),
       display_name = COALESCE(?, display_name),
       faculty_id = COALESCE(?, faculty_id),
       locale = COALESCE(?, locale),
       active = COALESCE(?, active),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    input.email?.toLowerCase() ?? null,
    input.displayName ?? null,
    input.facultyId ?? null,
    input.locale ?? null,
    input.active === undefined ? null : input.active ? 1 : 0,
    id,
  );
}

export function emailTaken(db: Db, email: string, exceptId?: number): boolean {
  return (
    db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(email.toLowerCase(), exceptId ?? -1) !== undefined
  );
}
