/** University announcements. Super admin only; displays read them through the resolver. */
import type { AnnouncementMode, AnnouncementTarget, NamedRef } from '@slidecast/shared';
import type { Db } from '../index.js';

export interface AnnouncementRecord {
  id: number;
  title: string;
  playlistId: number;
  playlistName: string;
  mode: AnnouncementMode;
  target: AnnouncementTarget;
  startsAt: string;
  endsAt: string | null;
  mixEveryNItems: number | null;
  createdAt: string;
}

interface Row {
  id: number;
  title: string;
  playlist_id: number;
  playlist_name: string;
  mode: AnnouncementMode;
  target_kind: 'all' | 'faculties' | 'displays';
  starts_at: string;
  ends_at: string | null;
  mix_every_n_items: number | null;
  created_at: string;
}

function targetsOf(db: Db, row: Row): AnnouncementTarget {
  if (row.target_kind === 'all') return { kind: 'all' };
  const rows = db
    .prepare('SELECT faculty_id, display_id FROM announcement_targets WHERE announcement_id = ?')
    .all(row.id) as { faculty_id: number | null; display_id: number | null }[];
  if (row.target_kind === 'faculties') {
    return { kind: 'faculties', facultyIds: rows.map((r) => r.faculty_id!).sort((a, b) => a - b) };
  }
  return { kind: 'displays', displayIds: rows.map((r) => r.display_id!).sort((a, b) => a - b) };
}

const SELECT = `SELECT a.*, p.name AS playlist_name FROM announcements a
  JOIN playlists p ON p.id = a.playlist_id`;

function toRecord(db: Db, r: Row): AnnouncementRecord {
  return {
    id: r.id,
    title: r.title,
    playlistId: r.playlist_id,
    playlistName: r.playlist_name,
    mode: r.mode,
    target: targetsOf(db, r),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    mixEveryNItems: r.mix_every_n_items,
    createdAt: r.created_at,
  };
}

export function listAnnouncements(db: Db): AnnouncementRecord[] {
  return (db.prepare(`${SELECT} ORDER BY a.starts_at DESC, a.id DESC`).all() as Row[]).map((r) =>
    toRecord(db, r),
  );
}

export function getAnnouncement(db: Db, id: number): AnnouncementRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
  return row && toRecord(db, row);
}

/**
 * Announcements reaching a display that have not ended by `after` (active and upcoming),
 * oldest start first.
 */
export function announcementsForDisplay(
  db: Db,
  display: { id: number; facultyId: number },
  after: string,
): AnnouncementRecord[] {
  const rows = db
    .prepare(
      `${SELECT} WHERE (a.ends_at IS NULL OR a.ends_at > @after) AND (
         a.target_kind = 'all'
         OR (a.target_kind = 'faculties' AND EXISTS (SELECT 1 FROM announcement_targets t
               WHERE t.announcement_id = a.id AND t.faculty_id = @faculty))
         OR (a.target_kind = 'displays' AND EXISTS (SELECT 1 FROM announcement_targets t
               WHERE t.announcement_id = a.id AND t.display_id = @display))
       ) ORDER BY a.starts_at, a.id`,
    )
    .all({ after, faculty: display.facultyId, display: display.id }) as Row[];
  return rows.map((r) => toRecord(db, r));
}

/** Every announcement that has not ended by `after` (for the scheduler). */
export function announcementsEndingAfter(db: Db, after: string): AnnouncementRecord[] {
  return (db.prepare(`${SELECT} WHERE a.ends_at IS NULL OR a.ends_at > ?`).all(after) as Row[]).map(
    (r) => toRecord(db, r),
  );
}

/** Ids of the paired displays an announcement reaches. */
export function targetedDisplayIds(db: Db, target: AnnouncementTarget): number[] {
  let rows: { id: number }[];
  if (target.kind === 'all') {
    rows = db.prepare("SELECT id FROM displays WHERE status = 'active'").all() as { id: number }[];
  } else if (target.kind === 'faculties') {
    const ph = target.facultyIds.map(() => '?').join(',');
    rows = db
      .prepare(`SELECT id FROM displays WHERE status = 'active' AND faculty_id IN (${ph})`)
      .all(...target.facultyIds) as { id: number }[];
  } else {
    const ph = target.displayIds.map(() => '?').join(',');
    rows = db
      .prepare(`SELECT id FROM displays WHERE status = 'active' AND id IN (${ph})`)
      .all(...target.displayIds) as { id: number }[];
  }
  return rows.map((r) => r.id);
}

export interface AnnouncementValues {
  title: string;
  playlistId: number;
  mode: AnnouncementMode;
  target: AnnouncementTarget;
  startsAt: string;
  endsAt: string | null;
  mixEveryNItems: number | null;
}

function writeTargets(db: Db, id: number, target: AnnouncementTarget): void {
  db.prepare('DELETE FROM announcement_targets WHERE announcement_id = ?').run(id);
  const ins = db.prepare(
    'INSERT INTO announcement_targets (announcement_id, faculty_id, display_id) VALUES (?, ?, ?)',
  );
  if (target.kind === 'faculties') for (const f of new Set(target.facultyIds)) ins.run(id, f, null);
  if (target.kind === 'displays') for (const d of new Set(target.displayIds)) ins.run(id, null, d);
}

export function insertAnnouncement(db: Db, v: AnnouncementValues, createdBy: number): number {
  const res = db
    .prepare(
      `INSERT INTO announcements (title, playlist_id, mode, target_kind, starts_at, ends_at, mix_every_n_items, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      v.title,
      v.playlistId,
      v.mode,
      v.target.kind,
      v.startsAt,
      v.endsAt,
      v.mode === 'mix' ? v.mixEveryNItems : null,
      createdBy,
    );
  const id = Number(res.lastInsertRowid);
  writeTargets(db, id, v.target);
  return id;
}

export function updateAnnouncement(db: Db, id: number, v: AnnouncementValues): void {
  db.prepare(
    `UPDATE announcements SET title = ?, playlist_id = ?, mode = ?, target_kind = ?, starts_at = ?,
       ends_at = ?, mix_every_n_items = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    v.title,
    v.playlistId,
    v.mode,
    v.target.kind,
    v.startsAt,
    v.endsAt,
    v.mode === 'mix' ? v.mixEveryNItems : null,
    id,
  );
  writeTargets(db, id, v.target);
}

export function deleteAnnouncement(db: Db, id: number): void {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
}

/** Announcements using a playlist (for "playlist in use"). */
export function announcementsUsingPlaylist(db: Db, playlistId: number): NamedRef[] {
  return db
    .prepare('SELECT id, title AS name FROM announcements WHERE playlist_id = ? ORDER BY title')
    .all(playlistId) as NamedRef[];
}

/** Ids of announcements (not ended by `after`) using a playlist. */
export function liveAnnouncementsUsingPlaylist(
  db: Db,
  playlistId: number,
  after: string,
): AnnouncementRecord[] {
  return announcementsEndingAfter(db, after).filter((a) => a.playlistId === playlistId);
}

/** Every distinct faculty and display id referenced, to validate a target. */
export function existingIds(db: Db, table: 'faculties' | 'displays', ids: number[]): Set<number> {
  if (ids.length === 0) return new Set();
  const ph = ids.map(() => '?').join(',');
  const extra = table === 'displays' ? " AND status = 'active'" : '';
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id IN (${ph})${extra}`).all(...ids) as {
    id: number;
  }[];
  return new Set(rows.map((r) => r.id));
}
