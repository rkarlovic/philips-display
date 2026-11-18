-- Milestone 5: university announcements (super admin only).

CREATE TABLE announcements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  -- Always a university playlist (faculty_id IS NULL), enforced by the API.
  playlist_id       INTEGER NOT NULL REFERENCES playlists (id) ON DELETE RESTRICT,
  mode              TEXT NOT NULL CHECK (mode IN ('mix', 'takeover')),
  target_kind       TEXT NOT NULL CHECK (target_kind IN ('all', 'faculties', 'displays')),
  -- UTC instants (ISO 8601). ends_at NULL = until ended by hand.
  starts_at         TEXT NOT NULL,
  ends_at           TEXT,
  -- Mix only: insert after every N items of the display's loop; NULL = once per loop.
  mix_every_n_items INTEGER CHECK (mix_every_n_items IS NULL OR mix_every_n_items >= 1),
  created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX announcements_window ON announcements (starts_at, ends_at);
CREATE INDEX announcements_playlist ON announcements (playlist_id);

-- For target_kind 'faculties' / 'displays': exactly one of faculty_id / display_id per row.
CREATE TABLE announcement_targets (
  announcement_id INTEGER NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
  faculty_id      INTEGER REFERENCES faculties (id) ON DELETE CASCADE,
  display_id      INTEGER REFERENCES displays (id) ON DELETE CASCADE,
  CHECK ((faculty_id IS NULL) <> (display_id IS NULL))
);
CREATE INDEX announcement_targets_ann ON announcement_targets (announcement_id);
CREATE INDEX announcement_targets_faculty ON announcement_targets (faculty_id);
CREATE INDEX announcement_targets_display ON announcement_targets (display_id);
