import crypto from 'node:crypto';
import type { Manifest } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import { getActiveDisplay } from '../db/repos/displays.js';
import { getPlaylist } from '../db/repos/playlists.js';
import { expandPlaylist } from './manifest.js';

/**
 * What should display X play now? (CLAUDE.md §7)
 *
 *   1. active takeover announcement   — milestone 5
 *   2. active schedule                — milestone 4
 *   3. the display's default playlist
 *   4. idle screen (faculty name + clock)
 *   5. mix-in announcements           — milestone 5
 *
 * Returns undefined for unknown / unpaired displays.
 */
export function resolveManifest(
  db: Db,
  displayId: number,
  opts: { timezone: string },
): Manifest | undefined {
  const display = getActiveDisplay(db, displayId);
  if (!display) return undefined;

  const playlist =
    display.defaultPlaylistId != null
      ? getPlaylist(db, { all: true }, display.defaultPlaylistId)
      : undefined;
  const items = playlist ? expandPlaylist(db, playlist) : [];

  const body: Omit<Manifest, 'version'> = {
    displayId: display.id,
    displayName: display.name,
    facultyName: display.facultyName,
    rotation: display.rotation,
    fit: display.fit,
    transition: playlist?.transition ?? 'fade',
    timezone: opts.timezone,
    source: items.length > 0 ? 'playlist' : 'idle',
    playlistId: playlist?.id ?? null,
    playlistName: playlist?.name ?? null,
    items,
  };
  const version = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { version, ...body };
}
