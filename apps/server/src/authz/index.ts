/**
 * The ONLY place access rules live (CLAUDE.md §6).
 *
 * - Every query for faculty-owned data takes a FacultyScope and uses scopeWhere().
 * - Anything outside the caller's scope is reported as 404, never 403, so ids don't leak.
 * - Super-admin-only routes call requireSuperAdmin().
 */
import type { FastifyRequest } from 'fastify';
import type { Me } from '@slidecast/shared';
import { forbidden, notFound, unauthorized } from '../errors.js';

export type SessionUser = Me;

export type FacultyScope = { all: true } | { all: false; facultyId: number };

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireSuperAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (user.role !== 'super_admin') throw forbidden();
  return user;
}

export function isSuperAdmin(user: SessionUser): boolean {
  return user.role === 'super_admin';
}

/** What faculty data this user may see. */
export function facultyScope(user: SessionUser): FacultyScope {
  if (user.role === 'super_admin') return { all: true };
  if (user.facultyId == null) throw new Error('faculty user without faculty');
  return { all: false, facultyId: user.facultyId };
}

/**
 * SQL filter for a faculty-owned table.
 * `includeShared` also matches university-wide rows (faculty_id IS NULL), read-only for faculties.
 */
export function scopeWhere(
  scope: FacultyScope,
  column = 'faculty_id',
  opts: { includeShared?: boolean } = {},
): { sql: string; params: number[] } {
  if (scope.all) return { sql: '1 = 1', params: [] };
  if (opts.includeShared) {
    return { sql: `(${column} = ? OR ${column} IS NULL)`, params: [scope.facultyId] };
  }
  return { sql: `${column} = ?`, params: [scope.facultyId] };
}

export function canAccessFaculty(scope: FacultyScope, facultyId: number | null): boolean {
  return scope.all || facultyId === scope.facultyId;
}

/** Returns the value, or throws 404 if a scoped lookup found nothing. */
export function found<T>(value: T | undefined | null): T {
  if (value == null) throw notFound();
  return value;
}
