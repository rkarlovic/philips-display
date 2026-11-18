import type { NamedRef } from '@slidecast/shared';
import type { Db } from '../index.js';
import { scopeWhere, type FacultyScope } from '../../authz/index.js';
import type { ScheduleRule } from '../../playback/schedule.js';

export interface ScheduleRecord extends ScheduleRule {
  displayId: number;
  facultyId: number;
  playlistId: number;
  playlistName: string;
  playlistFacultyId: number | null;
}

interface Row {
  id: number;
  display_id: number;
  faculty_id: number;
  playlist_id: number;
  playlist_name: string;
  playlist_faculty_id: number | null;
  weekdays: number;
  start_time: string;
  end_time: string;
  date_from: string | null;
  date_to: string | null;
  priority: number;
  created_at: string;
}

export const toMask = (days: number[]) => days.reduce((m, d) => m | (1 << (d - 1)), 0);
export const fromMask = (mask: number) =>
  [1, 2, 3, 4, 5, 6, 7].filter((d) => mask & (1 << (d - 1)));

const toRecord = (r: Row): ScheduleRecord => ({
  id: r.id,
  displayId: r.display_id,
  facultyId: r.faculty_id,
  playlistId: r.playlist_id,
  playlistName: r.playlist_name,
  playlistFacultyId: r.playlist_faculty_id,
  weekdays: fromMask(r.weekdays),
  startTime: r.start_time,
  endTime: r.end_time,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  priority: r.priority,
  createdAt: r.created_at,
});

const SELECT = `SELECT s.*, d.faculty_id, p.name AS playlist_name, p.faculty_id AS playlist_faculty_id
  FROM schedules s
  JOIN displays d ON d.id = s.display_id AND d.status = 'active'
  JOIN playlists p ON p.id = s.playlist_id`;

/** Schedules of one display (the caller has already checked access to the display). */
export function listSchedulesForDisplay(db: Db, displayId: number): ScheduleRecord[] {
  return (
    db
      .prepare(`${SELECT} WHERE s.display_id = ? ORDER BY s.priority DESC, s.start_time, s.id`)
      .all(displayId) as Row[]
  ).map(toRecord);
}

/** Unscoped: every schedule of every active display (for the scheduler). */
export function listAllSchedules(db: Db): ScheduleRecord[] {
  return (db.prepare(SELECT).all() as Row[]).map(toRecord);
}

export function getSchedule(db: Db, scope: FacultyScope, id: number): ScheduleRecord | undefined {
  const w = scopeWhere(scope, 'd.faculty_id');
  const row = db.prepare(`${SELECT} WHERE s.id = ? AND ${w.sql}`).get(id, ...w.params) as
    Row | undefined;
  return row && toRecord(row);
}

export interface ScheduleValues {
  playlistId: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  dateFrom: string | null;
  dateTo: string | null;
  priority: number;
}

export function insertSchedule(
  db: Db,
  displayId: number,
  v: ScheduleValues,
  createdAt: string,
): number {
  const res = db
    .prepare(
      `INSERT INTO schedules (display_id, playlist_id, weekdays, start_time, end_time, date_from, date_to, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      displayId,
      v.playlistId,
      toMask(v.weekdays),
      v.startTime,
      v.endTime,
      v.dateFrom,
      v.dateTo,
      v.priority,
      createdAt,
    );
  return Number(res.lastInsertRowid);
}

export function updateSchedule(db: Db, id: number, v: ScheduleValues): void {
  db.prepare(
    `UPDATE schedules SET playlist_id = ?, weekdays = ?, start_time = ?, end_time = ?,
       date_from = ?, date_to = ?, priority = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    v.playlistId,
    toMask(v.weekdays),
    v.startTime,
    v.endTime,
    v.dateFrom,
    v.dateTo,
    v.priority,
    id,
  );
}

export function deleteSchedule(db: Db, id: number): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

/** After a display moves faculty: drop schedules whose playlist belongs to another faculty. */
export function deleteSchedulesNotFitting(db: Db, displayId: number, facultyId: number): number {
  return db
    .prepare(
      `DELETE FROM schedules WHERE display_id = ? AND playlist_id IN
         (SELECT id FROM playlists WHERE faculty_id IS NOT NULL AND faculty_id != ?)`,
    )
    .run(displayId, facultyId).changes;
}

export function countSchedules(db: Db, displayId: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE display_id = ?').get(displayId) as {
      n: number;
    }
  ).n;
}

/** Displays that have this playlist in a schedule. */
export function displaysSchedulingPlaylist(db: Db, playlistId: number): NamedRef[] {
  return db
    .prepare(
      `SELECT DISTINCT d.id, d.name FROM schedules s JOIN displays d ON d.id = s.display_id
       WHERE s.playlist_id = ? ORDER BY d.name`,
    )
    .all(playlistId) as NamedRef[];
}
