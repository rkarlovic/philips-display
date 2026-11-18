import crypto from 'node:crypto';
import type { Db } from '../db/index.js';
import type { SessionUser } from '../authz/index.js';
import { findUserById } from '../db/repos/users.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Creates a session and returns the raw token (only the hash is stored). */
export function createSession(db: Db, userId: number, now: Date): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  );
  return token;
}

/** Resolves a session token to an active user, or null. Expired sessions are removed. */
export function getSessionUser(db: Db, token: string, now: Date): SessionUser | null {
  const id = hashToken(token);
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(id) as
    { user_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  const u = findUserById(db, row.user_id);
  if (!u || u.active !== 1) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    facultyId: u.faculty_id,
    facultyName: u.faculty_name,
    locale: u.locale,
  };
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

export function deleteUserSessions(db: Db, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db: Db, now: Date): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
}
