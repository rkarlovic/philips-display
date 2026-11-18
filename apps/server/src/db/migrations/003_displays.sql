-- Milestone 3: displays (pairing, settings, reported state).

CREATE TABLE displays (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL while pending (not yet paired to a faculty).
  faculty_id          INTEGER REFERENCES faculties (id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  name                TEXT NOT NULL DEFAULT '',
  location            TEXT NOT NULL DEFAULT '',
  -- Pending only: the code shown on screen, and the hash of the secret the player polls with.
  pairing_code        TEXT UNIQUE,
  claim_hash          TEXT UNIQUE,
  -- Raw device token, kept only until the player has picked it up after pairing.
  handoff_token       TEXT,
  token_hash          TEXT UNIQUE,
  rotation            INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  fit                 TEXT NOT NULL DEFAULT 'contain' CHECK (fit IN ('contain', 'cover')),
  default_playlist_id INTEGER REFERENCES playlists (id) ON DELETE RESTRICT,
  last_seen_at        TEXT,
  reported_state_json TEXT,
  user_agent          TEXT,
  paired_at           TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((status = 'pending' AND faculty_id IS NULL) OR (status = 'active' AND faculty_id IS NOT NULL))
);
CREATE INDEX displays_faculty ON displays (faculty_id);
CREATE INDEX displays_playlist ON displays (default_playlist_id);
