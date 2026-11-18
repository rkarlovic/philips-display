-- Milestone 1: faculties, users, sessions, audit log.

CREATE TABLE faculties (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  storage_quota_mb INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'faculty_user')),
  faculty_id    INTEGER REFERENCES faculties (id) ON DELETE RESTRICT,
  locale        TEXT NOT NULL DEFAULT 'hr' CHECK (locale IN ('hr', 'en')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  auth_provider TEXT NOT NULL DEFAULT 'email',
  password_hash TEXT,
  external_id   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (role = 'super_admin' AND faculty_id IS NULL) OR
    (role = 'faculty_user' AND faculty_id IS NOT NULL)
  )
);
CREATE INDEX users_faculty ON users (faculty_id);

-- id is the SHA-256 of the session token; the raw token only lives in the cookie.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  user_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  faculty_id   INTEGER REFERENCES faculties (id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  details_json TEXT
);
CREATE INDEX audit_log_at ON audit_log (at);
CREATE INDEX audit_log_faculty ON audit_log (faculty_id);
