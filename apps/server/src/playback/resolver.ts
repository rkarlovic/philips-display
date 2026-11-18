import crypto from 'node:crypto';
import type { AnnouncementRef, Manifest, ManifestItem, Playing } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import { announcementsForDisplay, type AnnouncementRecord } from '../db/repos/announcements.js';
import { getActiveDisplay, type DisplayRecord } from '../db/repos/displays.js';
import { getPlaylist } from '../db/repos/playlists.js';
import { listSchedulesForDisplay } from '../db/repos/schedules.js';
import { expandPlaylist } from './manifest.js';
import { mixInto } from './mix.js';
import { activeRule, activeUntil, nextBoundary } from './schedule.js';

export interface ResolveOptions {
  timezone: string;
  /** Injected clock. */
  now: Date;
}

type DisplayKey = Pick<
  DisplayRecord,
  'id' | 'facultyId' | 'defaultPlaylistId' | 'defaultPlaylistName'
>;

const ref = (a: AnnouncementRecord): AnnouncementRef => ({
  id: a.id,
  title: a.title,
  mode: a.mode,
  endsAt: a.endsAt,
});

const itemsOf = (db: Db, playlistId: number): ManifestItem[] => {
  const pl = getPlaylist(db, { all: true }, playlistId);
  return pl ? expandPlaylist(db, pl) : [];
};

/**
 * What should display X play now? (CLAUDE.md §7)
 *
 *   1. active takeover announcement targeting it (latest start wins; one with nothing
 *      ready to show is skipped rather than blanking the screen)
 *   2. active schedule (highest priority, ties → newest)
 *   3. the display's default playlist
 *   4. idle screen (faculty name + clock)
 *   5. active mix-in announcements are inserted into the loop of 2–4
 */
export function resolvePlaying(db: Db, display: DisplayKey, opts: ResolveOptions): Playing {
  const t = opts.now.getTime();
  const nowIso = opts.now.toISOString();

  // Announcements that reach this display and have not ended.
  const anns = announcementsForDisplay(db, display, nowIso);
  const active = anns.filter((a) => a.startsAt <= nowIso);
  const annBoundaries = anns
    .flatMap((a) => [a.startsAt, a.endsAt])
    .filter((b): b is string => b != null && b > nowIso)
    .map((b) => Date.parse(b));

  const rules = listSchedulesForDisplay(db, display.id);
  const schedNext = nextBoundary(rules, t, opts.timezone);
  const next = [schedNext, ...annBoundaries].filter((b): b is number => b != null);
  const nextChangeAt = next.length ? new Date(Math.min(...next)).toISOString() : null;

  const takeover = active
    .filter((a) => a.mode === 'takeover')
    .sort((a, b) => (a.startsAt === b.startsAt ? b.id - a.id : a.startsAt < b.startsAt ? 1 : -1))
    .find((a) => itemsOf(db, a.playlistId).length > 0);
  const mixIns = active.filter((a) => a.mode === 'mix').map(ref);

  if (takeover) {
    return {
      source: 'takeover',
      scheduleId: null,
      playlistId: takeover.playlistId,
      playlistName: takeover.playlistName,
      until: takeover.endsAt,
      nextChangeAt,
      takeover: ref(takeover),
      mixIns: [],
    };
  }

  const base = { nextChangeAt, takeover: null, mixIns };
  const rule = activeRule(rules, t, opts.timezone);
  if (rule) {
    const until = activeUntil(rule, t, opts.timezone);
    return {
      ...base,
      source: 'schedule',
      scheduleId: rule.id,
      playlistId: rule.playlistId,
      playlistName: rule.playlistName,
      until: until == null ? null : new Date(until).toISOString(),
    };
  }
  if (display.defaultPlaylistId != null) {
    return {
      ...base,
      source: 'default',
      scheduleId: null,
      playlistId: display.defaultPlaylistId,
      playlistName: display.defaultPlaylistName,
      until: null,
    };
  }
  return {
    ...base,
    source: mixIns.length > 0 ? 'mix' : 'idle',
    scheduleId: null,
    playlistId: null,
    playlistName: null,
    until: null,
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
  let items = playlist ? expandPlaylist(db, playlist) : [];

  if (playing.source !== 'takeover' && playing.mixIns.length > 0) {
    const anns = announcementsForDisplay(db, display, opts.now.toISOString());
    const mixes = playing.mixIns.map((m) => {
      const a = anns.find((x) => x.id === m.id)!;
      return { items: itemsOf(db, a.playlistId), everyN: a.mixEveryNItems };
    });
    items = mixInto(items, mixes);
  }

  const body: Omit<Manifest, 'version'> = {
    displayId: display.id,
    displayName: display.name,
    facultyName: display.facultyName,
    rotation: display.rotation,
    fit: display.fit,
    transition: playlist?.transition ?? 'fade',
    timezone: opts.timezone,
    source: items.length > 0 ? (playing.source === 'idle' ? 'mix' : playing.source) : 'idle',
    scheduleId: playing.scheduleId,
    announcementId: playing.takeover?.id ?? null,
    playlistId: playlist?.id ?? null,
    playlistName: playlist?.name ?? null,
    items,
  };
  // The version covers what is shown, not why: back-to-back schedules with the same
  // playlist don't restart the loop. It never includes the clock.
  const { source: _source, scheduleId: _scheduleId, announcementId: _ann, ...shown } = body;
  const version = crypto
    .createHash('sha1')
    .update(JSON.stringify(shown))
    .digest('hex')
    .slice(0, 16);
  return { version, ...body };
}
