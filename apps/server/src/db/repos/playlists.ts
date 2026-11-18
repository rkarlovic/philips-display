import type { MediaKind, MediaStatus, Playlist, PlaylistItem, Transition } from '@slidecast/shared';
import type { Db } from '../index.js';
import { scopeWhere, type FacultyScope } from '../../authz/index.js';
import { mediaUrl } from './media.js';

interface PlaylistRow {
  id: number;
  faculty_id: number | null;
  faculty_name: string | null;
  name: string;
  default_duration_sec: number;
  transition: Transition;
  item_count: number;
  created_at: string;
  updated_at: string;
}

const toPlaylist = (r: PlaylistRow): Playlist => ({
  id: r.id,
  facultyId: r.faculty_id,
  facultyName: r.faculty_name,
  name: r.name,
  defaultDurationSec: r.default_duration_sec,
  transition: r.transition,
  itemCount: r.item_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT = `SELECT pl.*, f.name AS faculty_name,
  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = pl.id) AS item_count
  FROM playlists pl LEFT JOIN faculties f ON f.id = pl.faculty_id`;

/** Faculty users see their own playlists; university playlists are super-admin only. */
export function listPlaylists(db: Db, scope: FacultyScope): Playlist[] {
  const w = scopeWhere(scope, 'pl.faculty_id');
  const rows = db
    .prepare(
      `${SELECT} WHERE ${w.sql} ORDER BY pl.faculty_id IS NOT NULL, f.name COLLATE NOCASE, pl.name COLLATE NOCASE`,
    )
    .all(...w.params) as PlaylistRow[];
  return rows.map(toPlaylist);
}

export function getPlaylist(db: Db, scope: FacultyScope, id: number): Playlist | undefined {
  const w = scopeWhere(scope, 'pl.faculty_id');
  const row = db.prepare(`${SELECT} WHERE pl.id = ? AND ${w.sql}`).get(id, ...w.params) as
    PlaylistRow | undefined;
  return row && toPlaylist(row);
}

interface ItemRow {
  id: number;
  position: number;
  media_id: number;
  duration_sec: number | null;
  page_from: number | null;
  page_to: number | null;
  kind: MediaKind;
  original_name: string;
  status: MediaStatus;
  thumb_file: string | null;
  duration_ms: number | null;
  page_count: number;
}

/** Items of a playlist the caller already has access to. */
export function getPlaylistItems(db: Db, playlistId: number): PlaylistItem[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.position, i.media_id, i.duration_sec, i.page_from, i.page_to,
         m.kind, m.original_name, m.status, m.thumb_file, m.duration_ms,
         (SELECT COUNT(*) FROM media_pages p WHERE p.media_id = m.id) AS page_count
       FROM playlist_items i JOIN media m ON m.id = i.media_id
       WHERE i.playlist_id = ? ORDER BY i.position`,
    )
    .all(playlistId) as ItemRow[];
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    mediaId: r.media_id,
    durationSec: r.duration_sec,
    pageFrom: r.page_from,
    pageTo: r.page_to,
    media: {
      kind: r.kind,
      originalName: r.original_name,
      status: r.status,
      thumbUrl: r.thumb_file ? mediaUrl(r.thumb_file) : null,
      pageCount: r.page_count,
      durationSec: r.duration_ms == null ? null : Math.round(r.duration_ms / 100) / 10,
    },
  }));
}

export function insertPlaylist(
  db: Db,
  input: {
    facultyId: number | null;
    name: string;
    defaultDurationSec: number;
    transition: Transition;
  },
): number {
  const res = db
    .prepare(
      'INSERT INTO playlists (faculty_id, name, default_duration_sec, transition) VALUES (?, ?, ?, ?)',
    )
    .run(input.facultyId, input.name, input.defaultDurationSec, input.transition);
  return Number(res.lastInsertRowid);
}

export function updatePlaylist(
  db: Db,
  id: number,
  input: { name?: string; defaultDurationSec?: number; transition?: Transition },
): void {
  db.prepare(
    `UPDATE playlists SET
       name = COALESCE(?, name),
       default_duration_sec = COALESCE(?, default_duration_sec),
       transition = COALESCE(?, transition),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(input.name ?? null, input.defaultDurationSec ?? null, input.transition ?? null, id);
}

export function touchPlaylist(db: Db, id: number): void {
  db.prepare(
    "UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
  ).run(id);
}

export function replacePlaylistItems(
  db: Db,
  playlistId: number,
  items: {
    mediaId: number;
    durationSec: number | null;
    pageFrom: number | null;
    pageTo: number | null;
  }[],
): void {
  db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
  const ins = db.prepare(
    `INSERT INTO playlist_items (playlist_id, position, media_id, duration_sec, page_from, page_to)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  items.forEach((it, i) =>
    ins.run(playlistId, i, it.mediaId, it.durationSec, it.pageFrom, it.pageTo),
  );
}

export function deletePlaylist(db: Db, id: number): void {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
}

/** Unscoped owner lookup for media ids (to check they may go into a playlist). */
export function mediaOwners(db: Db, ids: number[]): Map<number, number | null> {
  const map = new Map<number, number | null>();
  if (ids.length === 0) return map;
  const rows = db
    .prepare(`SELECT id, faculty_id FROM media WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: number; faculty_id: number | null }[];
  for (const r of rows) map.set(r.id, r.faculty_id);
  return map;
}
