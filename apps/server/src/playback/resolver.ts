import crypto from 'node:crypto';
import type { Manifest, Playing } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import { getActiveDisplay, type DisplayRecord } from '../db/repos/displays.js';
import { getPlaylist } from '../db/repos/playlists.js';
import { listSchedulesForDisplay } from '../db/repos/schedules.js';
import { expandPlaylist } from './manifest.js';
import { activeRule, activeUntil, nextBoundary } from './schedule.js';

export interface ResolveOptions {
  timezone: string;
  /** Injected clock. */
  now: Date;
}

/**
 * What should display X play now? (CLAUDE.md §7)
 *
 *   1. active takeover announcement   — milestone 5
 *   2. active schedule (highest priority, ties → newest)
 *   3. the display's default playlist
 *   4. idle screen (faculty name + clock)
 *   5. mix-in announcements           — milestone 5
 */
export function resolvePlaying(
  db: Db,
  display: Pick<DisplayRecord, 'id' | 'defaultPlaylistId' | 'defaultPlaylistName'>,
  opts: ResolveOptions,
): Playing {
  const t = opts.now.getTime();
  const rules = listSchedulesForDisplay(db, display.id);
  const next = nextBoundary(rules, t, opts.timezone);
  const nextChangeAt = next == null ? null : new Date(next).toISOString();

  const rule = activeRule(rules, t, opts.timezone);
  if (rule) {
    const until = activeUntil(rule, t, opts.timezone);
    return {
      source: 'schedule',
      scheduleId: rule.id,
      playlistId: rule.playlistId,
      playlistName: rule.playlistName,
      until: until == null ? null : new Date(until).toISOString(),
      nextChangeAt,
    };
  }
  if (display.defaultPlaylistId != null) {
    return {
      source: 'default',
      scheduleId: null,
      playlistId: display.defaultPlaylistId,
      playlistName: display.defaultPlaylistName,
      until: null,
      nextChangeAt,
    };
  }
  return {
    source: 'idle',
    scheduleId: null,
    playlistId: null,
    playlistName: null,
    until: null,
    nextChangeAt,
  };
}

/** The flat manifest for a display; undefined for unknown / unpaired displays. */
export function resolveManifest(
  db: Db,
  displayId: number,
  opts: ResolveOptions,
): Manifest | undefined {
  const display = getActiveDisplay(db, displayId);
  if (!display) return undefined;

  const playing = resolvePlaying(db, display, opts);
  const playlist =
    playing.playlistId != null ? getPlaylist(db, { all: true }, playing.playlistId) : undefined;
  const items = playlist ? expandPlaylist(db, playlist) : [];

  const body: Omit<Manifest, 'version'> = {
    displayId: display.id,
    displayName: display.name,
    facultyName: display.facultyName,
    rotation: display.rotation,
    fit: display.fit,
    transition: playlist?.transition ?? 'fade',
    timezone: opts.timezone,
    source: items.length > 0 ? playing.source : 'idle',
    scheduleId: playing.scheduleId,
    playlistId: playlist?.id ?? null,
    playlistName: playlist?.name ?? null,
    items,
  };
  // The version covers what is shown, not why: back-to-back schedules with the same
  // playlist don't restart the loop. It never includes the clock.
  const { source: _source, scheduleId: _scheduleId, ...shown } = body;
  const version = crypto
    .createHash('sha1')
    .update(JSON.stringify(shown))
    .digest('hex')
    .slice(0, 16);
  return { version, ...body };
}
