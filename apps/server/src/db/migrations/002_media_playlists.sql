-- Milestone 2: media library and playlists.

-- faculty_id NULL = university (shared) media, managed by the super admin.
CREATE TABLE media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_id    INTEGER REFERENCES faculties (id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL CHECK (kind IN ('pdf', 'pptx', 'image', 'video')),
  original_name TEXT NOT NULL,
  size          INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error         TEXT,
  uploaded_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  -- Content-addressed file names under data/media (e.g. '<sha256>.webp').
  thumb_file    TEXT,
  video_file    TEXT,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX media_faculty ON media (faculty_id);

-- Rendered pages. PDF/PPTX: one per page/slide. Image: a single page. Video: none.
CREATE TABLE media_pages (
  media_id   INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  page_no    INTEGER NOT NULL,
  file       TEXT NOT NULL,
  thumb_file TEXT NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  PRIMARY KEY (media_id, page_no)
);

-- faculty_id NULL = university playlist.
CREATE TABLE playlists (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_id           INTEGER REFERENCES faculties (id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL,
  default_duration_sec INTEGER NOT NULL DEFAULT 10 CHECK (default_duration_sec BETWEEN 1 AND 86400),
  transition           TEXT NOT NULL DEFAULT 'fade' CHECK (transition IN ('none', 'fade')),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX playlists_faculty ON playlists (faculty_id);

CREATE TABLE playlist_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id  INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  -- RESTRICT: media used in a playlist cannot be deleted.
  media_id     INTEGER NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  duration_sec INTEGER CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 86400),
  page_from    INTEGER CHECK (page_from IS NULL OR page_from >= 1),
  page_to      INTEGER CHECK (page_to IS NULL OR page_to >= 1),
  UNIQUE (playlist_id, position)
);
CREATE INDEX playlist_items_media ON playlist_items (media_id);
