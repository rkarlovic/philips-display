import { hash, verify } from '@node-rs/argon2';
import type { Db } from '../db/index.js';
import { findUserByEmail } from '../db/repos/users.js';
import type { AuthProvider } from './provider.js';

/**
 * v1 login (CLAUDE.md §6):
 * - an active user whose email is on the list is logged in;
 * - a user with a password hash (today only the super admin) must also send the password.
 * This is separation, not security.
 */
export function createEmailAuthProvider(db: Db): AuthProvider {
  return {
    id: 'email',
    async authenticate({ email, password }) {
      const user = findUserByEmail(db, email);
      if (!user || user.active !== 1) return { ok: false, error: 'not_registered' };
      if (user.password_hash) {
        if (!password) return { ok: false, error: 'password_required' };
        const valid = await verify(user.password_hash, password).catch(() => false);
        if (!valid) return { ok: false, error: 'invalid_credentials' };
      }
      return { ok: true, userId: user.id };
    },
  };
}

export const hashPassword = (password: string) => hash(password);

/**
 * Makes sure the super admin from env exists, is active and has the env password.
 * Any other super admin rows (e.g. after SUPERADMIN_EMAIL changed) are deactivated.
 */
export async function ensureSuperAdmin(db: Db, email: string, password: string): Promise<number> {
  const existing = findUserByEmail(db, email);
  if (existing && existing.role !== 'super_admin') {
    throw new Error(
      `SUPERADMIN_EMAIL ${email} already belongs to a faculty user. Use a different email.`,
    );
  }

  let id: number;
  if (!existing) {
    const res = db
      .prepare(
        `INSERT INTO users (email, display_name, role, faculty_id, locale, auth_provider, password_hash)
         VALUES (?, 'Super admin', 'super_admin', NULL, 'hr', 'email', ?)`,
      )
      .run(email, await hashPassword(password));
    id = Number(res.lastInsertRowid);
  } else {
    id = existing.id;
    const same =
      existing.password_hash != null &&
      (await verify(existing.password_hash, password).catch(() => false));
    const newHash = same ? existing.password_hash : await hashPassword(password);
    db.prepare('UPDATE users SET active = 1, password_hash = ? WHERE id = ?').run(newHash, id);
    if (!same) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  const others = db
    .prepare("SELECT id FROM users WHERE role = 'super_admin' AND id != ? AND active = 1")
    .all(id) as { id: number }[];
  for (const o of others) {
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(o.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(o.id);
  }
  return id;
}
