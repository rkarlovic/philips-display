import type {
  Media,
  MediaErrorCode,
  MediaKind,
  MediaPage,
  MediaStatus,
  NamedRef,
} from '@slidecast/shared';
import type { Db } from '../index.js';
import { scopeWhere, type FacultyScope } from '../../authz/index.js';

/** Public URL of a content-addressed file in data/media. */
export const mediaUrl = (file: string) => `/media/${file}`;

interface MediaRow {
  id: number;
  faculty_id: number | null;
  faculty_name: string | null;
  kind: MediaKind;
  original_name: string;
  size: number;
  status: MediaStatus;
  error: MediaErrorCode | null;
  thumb_file: string | null;
  video_file: string | null;
  duration_ms: number | null;
  page_count: number;
  uploader_email: string | null;
  created_at: string;
}

export interface MediaRecord extends Media {
  /** Raw file names, for the pipeline and cleanup. */
  files: { thumb: string | null; video: string | null };
}

const toMedia = (r: MediaRow, scope: FacultyScope): MediaRecord => ({
  id: r.id,
  facultyId: r.faculty_id,
  facultyName: r.faculty_name,
  kind: r.kind,
  originalName: r.original_name,
  size: r.size,
  status: r.status,
  error: r.error,
  thumbUrl: r.thumb_file ? mediaUrl(r.thumb_file) : null,
  videoUrl: r.video_file ? mediaUrl(r.video_file) : null,
  durationSec: r.duration_ms == null ? null : Math.round(r.duration_ms / 100) / 10,
  pageCount: r.page_count,
  uploadedBy: r.uploader_email,
  createdAt: r.created_at,
  readOnly: !scope.all && r.faculty_id == null,
  files: { thumb: r.thumb_file, video: r.video_file },
});

const SELECT = `SELECT m.*, f.name AS faculty_name, u.email AS uploader_email,
  (SELECT COUNT(*) FROM media_pages p WHERE p.media_id = m.id) AS page_count
  FROM media m
  LEFT JOIN faculties f ON f.id = m.faculty_id
  LEFT JOIN users u ON u.id = m.uploaded_by`;

/** Media visible in the scope: own faculty plus university media (read-only). */
export function listMedia(
  db: Db,
  scope: FacultyScope,
  owner?: 'university' | number,
): MediaRecord[] {
  const w = scopeWhere(scope, 'm.faculty_id', { includeShared: true });
  let extra = '';
  const params: unknown[] = [...w.params];
  if (owner === 'university') extra = ' AND m.faculty_id IS NULL';
  else if (typeof owner === 'number') {
    extra = ' AND m.faculty_id = ?';
    params.push(owner);
  }
  const rows = db
    .prepare(`${SELECT} WHERE ${w.sql}${extra} ORDER BY m.id DESC`)
    .all(...params) as MediaRow[];
  return rows.map((r) => toMedia(r, scope));
}

export function getMedia(db: Db, scope: FacultyScope, id: number): MediaRecord | undefined {
  const w = scopeWhere(scope, 'm.faculty_id', { includeShared: true });
  const row = db.prepare(`${SELECT} WHERE m.id = ? AND ${w.sql}`).get(id, ...w.params) as
    MediaRow | undefined;
  return row && toMedia(row, scope);
}

interface PageRow {
  page_no: number;
  file: string;
  thumb_file: string;
  width: number;
  height: number;
}

export function getMediaPages(db: Db, mediaId: number): (MediaPage & { file: string })[] {
  const rows = db
    .prepare(
      'SELECT page_no, file, thumb_file, width, height FROM media_pages WHERE media_id = ? ORDER BY page_no',
    )
    .all(mediaId) as PageRow[];
  return rows.map((r) => ({
    pageNo: r.page_no,
    url: mediaUrl(r.file),
    thumbUrl: mediaUrl(r.thumb_file),
    width: r.width,
    height: r.height,
    file: r.file,
  }));
}

export function insertMedia(
  db: Db,
  input: {
    facultyId: number | null;
    kind: MediaKind;
    originalName: string;
    size: number;
    uploadedBy: number;
  },
): number {
  const res = db
    .prepare(
      `INSERT INTO media (faculty_id, kind, original_name, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.facultyId, input.kind, input.originalName, input.size, input.uploadedBy);
  return Number(res.lastInsertRowid);
}

export interface ProcessedPage {
  file: string;
  thumbFile: string;
  width: number;
  height: number;
}

export function setMediaReady(
  db: Db,
  id: number,
  result: {
    thumbFile: string | null;
    videoFile?: string | null;
    durationMs?: number | null;
    pages: ProcessedPage[];
  },
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM media_pages WHERE media_id = ?').run(id);
    const ins = db.prepare(
      'INSERT INTO media_pages (media_id, page_no, file, thumb_file, width, height) VALUES (?, ?, ?, ?, ?, ?)',
    );
    result.pages.forEach((p, i) => ins.run(id, i + 1, p.file, p.thumbFile, p.width, p.height));
    db.prepare(
      `UPDATE media SET status = 'ready', error = NULL, thumb_file = ?, video_file = ?, duration_ms = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(result.thumbFile, result.videoFile ?? null, result.durationMs ?? null, id);
  })();
}

export function setMediaFailed(db: Db, id: number, error: MediaErrorCode): void {
  db.prepare(
    `UPDATE media SET status = 'failed', error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(error, id);
}

/** Unscoped: media whose processing was interrupted (used at startup). */
export function listProcessingMedia(db: Db): { id: number; kind: MediaKind }[] {
  return db.prepare("SELECT id, kind FROM media WHERE status = 'processing'").all() as {
    id: number;
    kind: MediaKind;
  }[];
}

/** Unscoped: kind of a media row (used by the job runner). */
export function getMediaKind(db: Db, id: number): MediaKind | undefined {
  const row = db.prepare('SELECT kind FROM media WHERE id = ?').get(id) as
    { kind: MediaKind } | undefined;
  return row?.kind;
}

export function renameMedia(db: Db, id: number, originalName: string): void {
  db.prepare(
    "UPDATE media SET original_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
  ).run(originalName, id);
}

/** Deletes the row (pages cascade) and returns the files it referenced. */
export function deleteMediaRow(db: Db, id: number): string[] {
  return db.transaction(() => {
    const files = new Set<string>();
    const m = db.prepare('SELECT thumb_file, video_file FROM media WHERE id = ?').get(id) as
      { thumb_file: string | null; video_file: string | null } | undefined;
    if (m?.thumb_file) files.add(m.thumb_file);
    if (m?.video_file) files.add(m.video_file);
    for (const p of db
      .prepare('SELECT file, thumb_file FROM media_pages WHERE media_id = ?')
      .all(id) as { file: string; thumb_file: string }[]) {
      files.add(p.file);
      files.add(p.thumb_file);
    }
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
    return [...files];
  })();
}

/** Playlists visible in the scope that contain this media. */
export function playlistsUsingMedia(db: Db, scope: FacultyScope, mediaId: number): NamedRef[] {
  const w = scopeWhere(scope, 'pl.faculty_id');
  return db
    .prepare(
      `SELECT DISTINCT pl.id, pl.name FROM playlist_items i
       JOIN playlists pl ON pl.id = i.playlist_id
       WHERE i.media_id = ? AND ${w.sql} ORDER BY pl.name`,
    )
    .all(mediaId, ...w.params) as NamedRef[];
}

/** Unscoped: is the media used by any playlist at all? */
export function isMediaUsed(db: Db, mediaId: number): boolean {
  return (
    db.prepare('SELECT 1 FROM playlist_items WHERE media_id = ? LIMIT 1').get(mediaId) !== undefined
  );
}

/** Bytes counted against a faculty's quota (original upload sizes). */
export function facultyUsedBytes(db: Db, facultyId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE faculty_id = ?')
    .get(facultyId) as { n: number };
  return row.n;
}

/** Is a content-addressed file still referenced by any media row? */
export function isFileReferenced(db: Db, name: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM media WHERE thumb_file = @name OR video_file = @name
         UNION ALL SELECT 1 FROM media_pages WHERE file = @name OR thumb_file = @name LIMIT 1`,
      )
      .get({ name }) !== undefined
  );
}
