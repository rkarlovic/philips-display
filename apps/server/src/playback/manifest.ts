import type { ManifestItem, Playlist } from '@slidecast/shared';
import type { Db } from '../db/index.js';
import { getMediaPages } from '../db/repos/media.js';
import { getPlaylistItems } from '../db/repos/playlists.js';
import { mediaUrl } from '../db/repos/media.js';

/**
 * Flattens a playlist into the ordered loop a display plays:
 * - PDF/PPTX: one image step per page (within page_from..page_to), each `durationSec`;
 * - image: one step; video: one step that plays to its end unless a duration is set;
 * - durations fall back to the playlist default; media that isn't ready is skipped.
 * The caller must already have checked access to the playlist.
 */
export function expandPlaylist(db: Db, playlist: Playlist): ManifestItem[] {
  const out: ManifestItem[] = [];
  for (const item of getPlaylistItems(db, playlist.id)) {
    if (item.media.status !== 'ready') continue;
    if (item.media.kind === 'video') {
      const video = db.prepare('SELECT video_file FROM media WHERE id = ?').get(item.mediaId) as
        { video_file: string | null } | undefined;
      if (!video?.video_file) continue;
      out.push({
        type: 'video',
        url: mediaUrl(video.video_file),
        durationSec: item.durationSec,
        mediaId: item.mediaId,
        pageNo: null,
      });
      continue;
    }
    const duration = item.durationSec ?? playlist.defaultDurationSec;
    const from = item.pageFrom ?? 1;
    const to = item.pageTo ?? Number.MAX_SAFE_INTEGER;
    for (const page of getMediaPages(db, item.mediaId)) {
      if (page.pageNo < from || page.pageNo > to) continue;
      out.push({
        type: 'image',
        url: page.url,
        durationSec: duration,
        mediaId: item.mediaId,
        pageNo: item.media.kind === 'image' ? null : page.pageNo,
      });
    }
  }
  return out;
}
