/**
 * The ONLY place access rules live (CLAUDE.md §6).
 *
 * - Every query for faculty-owned data takes a FacultyScope and uses scopeWhere().
 * - Anything outside the caller's scope is reported as 404, never 403, so ids don't leak.
 * - Super-admin-only routes call requireSuperAdmin().
 */
import type { FastifyRequest } from 'fastify';
import type { Me } from '@slidecast/shared';
import { HttpError, forbidden, notFound, unauthorized } from '../errors.js';

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

/**
 * For rows the caller can already see: university rows (faculty_id NULL) are
 * read-only for faculty users.
 */
export function assertWritable(scope: FacultyScope, ownerFacultyId: number | null): void {
  if (!scope.all && ownerFacultyId == null) {
    throw new HttpError(403, 'read_only', 'University content is read-only');
  }
}

/**
 * Owner for a new faculty-owned row. Faculty users always create in their own faculty;
 * the super admin picks a faculty, or null for university content.
 */
export function ownerForCreate(
  scope: FacultyScope,
  requested: number | null | undefined,
): number | null {
  return scope.all ? (requested ?? null) : scope.facultyId;
}

/** Can media owned by `mediaOwner` go into a playlist owned by `playlistOwner`? */
export function mediaFitsPlaylist(
  mediaOwner: number | null,
  playlistOwner: number | null,
): boolean {
  return mediaOwner == null || mediaOwner === playlistOwner;
}

/** Throws 403 for anyone but the super admin (for fields only IT may change). */
export function forbiddenUnlessSuperAdmin(user: SessionUser): void {
  if (user.role !== 'super_admin') throw forbidden();
}

/** A display may play its own faculty's playlists, or university playlists. */
export function playlistFitsDisplay(playlistOwner: number | null, displayFaculty: number): boolean {
  return playlistOwner == null || playlistOwner === displayFaculty;
}

export function canAccessFaculty(scope: FacultyScope, facultyId: number | null): boolean {
  return scope.all || facultyId === scope.facultyId;
}

/** Returns the value, or throws 404 if a scoped lookup found nothing. */
export function found<T>(value: T | undefined | null): T {
  if (value == null) throw notFound();
  return value;
}
