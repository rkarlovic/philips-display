/**
 * Which displays may need a new manifest when a playlist or media item changes:
 * via their default playlist, a schedule, or a (not yet ended) announcement.
 * Over-including is harmless: players ignore a push whose version they already have.
 */
import type { Db } from '../db/index.js';
import { displaysUsingPlaylist } from '../db/repos/displays.js';
import { liveAnnouncementsUsingPlaylist, targetedDisplayIds } from '../db/repos/announcements.js';
import { playlistIdsWithMedia } from '../db/repos/playlists.js';

export function displayIdsForPlaylist(db: Db, playlistId: number, now: Date): number[] {
  const ids = new Set(displaysUsingPlaylist(db, playlistId).map((d) => d.id));
  for (const a of liveAnnouncementsUsingPlaylist(db, playlistId, now.toISOString())) {
    for (const id of targetedDisplayIds(db, a.target)) ids.add(id);
  }
  return [...ids];
}

export function displayIdsForMedia(db: Db, mediaId: number, now: Date): number[] {
  const ids = new Set<number>();
  for (const pl of playlistIdsWithMedia(db, mediaId)) {
    for (const id of displayIdsForPlaylist(db, pl, now)) ids.add(id);
  }
  return [...ids];
}
