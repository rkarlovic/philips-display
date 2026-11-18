import type {
  Display,
  DisplayState,
  Fit,
  NamedRef,
  PendingDisplay,
  Rotation,
} from '@slidecast/shared';
import type { Db } from '../index.js';
import { scopeWhere, type FacultyScope } from '../../authz/index.js';

interface DisplayRow {
  id: number;
  faculty_id: number;
  faculty_name: string;
  name: string;
  location: string;
  rotation: Rotation;
  fit: Fit;
  default_playlist_id: number | null;
  default_playlist_name: string | null;
  last_seen_at: string | null;
  paired_at: string | null;
  reported_state_json: string | null;
  now_media_name: string | null;
}

/** A display as stored; `online` comes from the WebSocket hub. */
export type DisplayRecord = Omit<Display, 'online' | 'playing' | 'scheduleCount'>;

function parseState(json: string | null): DisplayState | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as DisplayState;
  } catch {
    return null;
  }
}

const toRecord = (r: DisplayRow): DisplayRecord => {
  const state = parseState(r.reported_state_json);
  return {
    id: r.id,
    facultyId: r.faculty_id,
    facultyName: r.faculty_name,
    name: r.name,
    location: r.location,
    rotation: r.rotation,
    fit: r.fit,
    defaultPlaylistId: r.default_playlist_id,
    defaultPlaylistName: r.default_playlist_name,
    lastSeenAt: r.last_seen_at,
    pairedAt: r.paired_at,
    state,
    nowPlaying:
      state?.mediaId && r.now_media_name
        ? { mediaName: r.now_media_name, pageNo: state.pageNo }
        : null,
  };
};

const SELECT = `SELECT d.id, d.faculty_id, f.name AS faculty_name, d.name, d.location, d.rotation, d.fit,
  d.default_playlist_id, p.name AS default_playlist_name, d.last_seen_at, d.paired_at,
  d.reported_state_json,
  (SELECT m.original_name FROM media m
    WHERE m.id = json_extract(d.reported_state_json, '$.mediaId')) AS now_media_name
  FROM displays d
  JOIN faculties f ON f.id = d.faculty_id
  LEFT JOIN playlists p ON p.id = d.default_playlist_id`;

/** Active (paired) displays in the scope. */
export function listDisplays(db: Db, scope: FacultyScope): DisplayRecord[] {
  const w = scopeWhere(scope, 'd.faculty_id');
  const rows = db
    .prepare(
      `${SELECT} WHERE d.status = 'active' AND ${w.sql} ORDER BY f.name COLLATE NOCASE, d.name COLLATE NOCASE`,
    )
    .all(...w.params) as DisplayRow[];
  return rows.map(toRecord);
}

export function getDisplay(db: Db, scope: FacultyScope, id: number): DisplayRecord | undefined {
  const w = scopeWhere(scope, 'd.faculty_id');
  const row = db
    .prepare(`${SELECT} WHERE d.id = ? AND d.status = 'active' AND ${w.sql}`)
    .get(id, ...w.params) as DisplayRow | undefined;
  return row && toRecord(row);
}

/** Unscoped: for the player (token-authenticated) and the hub. */
export function getActiveDisplay(db: Db, id: number): DisplayRecord | undefined {
  return getDisplay(db, { all: true }, id);
}

export function findDisplayIdByTokenHash(db: Db, tokenHash: string): number | undefined {
  const row = db
    .prepare("SELECT id FROM displays WHERE token_hash = ? AND status = 'active'")
    .get(tokenHash) as { id: number } | undefined;
  return row?.id;
}

// ---------- pairing ----------

export function createPendingDisplay(
  db: Db,
  input: { code: string; claimHash: string; userAgent: string | null; now: string },
): number {
  const res = db
    .prepare(
      `INSERT INTO displays (status, pairing_code, claim_hash, user_agent, last_seen_at)
       VALUES ('pending', ?, ?, ?, ?)`,
    )
    .run(input.code, input.claimHash, input.userAgent, input.now);
  return Number(res.lastInsertRowid);
}

export function pairingCodeInUse(db: Db, code: string): boolean {
  return db.prepare('SELECT 1 FROM displays WHERE pairing_code = ?').get(code) !== undefined;
}

interface ClaimRow {
  id: number;
  status: 'pending' | 'active';
  pairing_code: string | null;
  handoff_token: string | null;
}

export function findByClaim(db: Db, claimHash: string): ClaimRow | undefined {
  return db
    .prepare('SELECT id, status, pairing_code, handoff_token FROM displays WHERE claim_hash = ?')
    .get(claimHash) as ClaimRow | undefined;
}

export function findPendingIdByCode(db: Db, code: string): number | undefined {
  const row = db
    .prepare("SELECT id FROM displays WHERE status = 'pending' AND pairing_code = ?")
    .get(code) as { id: number } | undefined;
  return row?.id;
}

export function touchDisplay(db: Db, id: number, now: string): void {
  db.prepare('UPDATE displays SET last_seen_at = ? WHERE id = ?').run(now, id);
}

/** Pending displays not seen since `before` are forgotten. */
export function purgeStalePending(db: Db, before: string): number {
  return db
    .prepare(
      "DELETE FROM displays WHERE status = 'pending' AND COALESCE(last_seen_at, created_at) < ?",
    )
    .run(before).changes;
}

export function listPending(db: Db): PendingDisplay[] {
  const rows = db
    .prepare(
      `SELECT id, pairing_code, created_at, last_seen_at, user_agent FROM displays
       WHERE status = 'pending' ORDER BY id DESC`,
    )
    .all() as {
    id: number;
    pairing_code: string;
    created_at: string;
    last_seen_at: string | null;
    user_agent: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    code: r.pairing_code,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    userAgent: r.user_agent,
  }));
}

export function activateDisplay(
  db: Db,
  id: number,
  input: {
    facultyId: number;
    name: string;
    location: string;
    rotation: Rotation;
    fit: Fit;
    tokenHash: string;
    handoffToken: string;
    now: string;
  },
): void {
  db.prepare(
    `UPDATE displays SET status = 'active', faculty_id = ?, name = ?, location = ?, rotation = ?, fit = ?,
       token_hash = ?, handoff_token = ?, pairing_code = NULL, paired_at = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND status = 'pending'`,
  ).run(
    input.facultyId,
    input.name,
    input.location,
    input.rotation,
    input.fit,
    input.tokenHash,
    input.handoffToken,
    input.now,
    id,
  );
}

/** Hands the raw token to the player exactly once, then forgets it and the claim. */
export function takeHandoffToken(db: Db, id: number): string | null {
  return db.transaction(() => {
    const row = db.prepare('SELECT handoff_token FROM displays WHERE id = ?').get(id) as
      { handoff_token: string | null } | undefined;
    db.prepare('UPDATE displays SET handoff_token = NULL, claim_hash = NULL WHERE id = ?').run(id);
    return row?.handoff_token ?? null;
  })();
}

export function replaceToken(db: Db, id: number, tokenHash: string): void {
  db.prepare(
    "UPDATE displays SET token_hash = ?, handoff_token = NULL, claim_hash = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
  ).run(tokenHash, id);
}

// ---------- settings and state ----------

export function updateDisplay(
  db: Db,
  id: number,
  input: {
    name?: string;
    location?: string;
    rotation?: Rotation;
    fit?: Fit;
    facultyId?: number;
    defaultPlaylistId?: number | null;
  },
): void {
  db.prepare(
    `UPDATE displays SET
       name = COALESCE(?, name),
       location = COALESCE(?, location),
       rotation = COALESCE(?, rotation),
       fit = COALESCE(?, fit),
       faculty_id = COALESCE(?, faculty_id),
       default_playlist_id = CASE WHEN ? THEN ? ELSE default_playlist_id END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    input.name ?? null,
    input.location ?? null,
    input.rotation ?? null,
    input.fit ?? null,
    input.facultyId ?? null,
    input.defaultPlaylistId !== undefined ? 1 : 0,
    input.defaultPlaylistId ?? null,
    id,
  );
}

export function setReportedState(db: Db, id: number, state: DisplayState, now: string): void {
  db.prepare('UPDATE displays SET reported_state_json = ?, last_seen_at = ? WHERE id = ?').run(
    JSON.stringify(state),
    now,
    id,
  );
}

export function setUserAgent(db: Db, id: number, userAgent: string | null): void {
  db.prepare('UPDATE displays SET user_agent = ? WHERE id = ?').run(userAgent, id);
}

/** Unscoped, any status (pending or active): super admin revoke only. */
export function getDisplayAnyStatus(
  db: Db,
  id: number,
): { id: number; faculty_id: number | null; name: string; status: string } | undefined {
  return db.prepare('SELECT id, faculty_id, name, status FROM displays WHERE id = ?').get(id) as
    { id: number; faculty_id: number | null; name: string; status: string } | undefined;
}

export function deleteDisplay(db: Db, id: number): void {
  db.prepare('DELETE FROM displays WHERE id = ?').run(id);
}

/** Displays (any faculty) that use this playlist as default or in a schedule. */
export function displaysUsingPlaylist(db: Db, playlistId: number): NamedRef[] {
  return db
    .prepare(
      `SELECT id, name FROM displays WHERE status = 'active' AND (
         default_playlist_id = @p OR id IN (SELECT display_id FROM schedules WHERE playlist_id = @p)
       ) ORDER BY name`,
    )
    .all({ p: playlistId }) as NamedRef[];
}

/** Display ids whose manifest may contain this media (via default or scheduled playlists). */
export function displayIdsUsingMedia(db: Db, mediaId: number): number[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT d.id FROM displays d
         WHERE d.status = 'active' AND (
           d.default_playlist_id IN (SELECT playlist_id FROM playlist_items WHERE media_id = @m)
           OR d.id IN (SELECT s.display_id FROM schedules s
                       JOIN playlist_items i ON i.playlist_id = s.playlist_id WHERE i.media_id = @m)
         )`,
      )
      .all({ m: mediaId }) as { id: number }[]
  ).map((r) => r.id);
}
