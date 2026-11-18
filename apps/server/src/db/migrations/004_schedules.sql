-- Milestone 4: per-display schedules.

CREATE TABLE schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  display_id  INTEGER NOT NULL REFERENCES displays (id) ON DELETE CASCADE,
  playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE RESTRICT,
  -- Bit (n-1) set = ISO weekday n (1 = Monday … 7 = Sunday) is included.
  weekdays    INTEGER NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  start_time  TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time    TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  date_from   TEXT,
  date_to     TEXT,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
);
CREATE INDEX schedules_display ON schedules (display_id);
CREATE INDEX schedules_playlist ON schedules (playlist_id);
