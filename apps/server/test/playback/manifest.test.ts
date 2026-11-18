/** Playlist → flat loop (what a display will play). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Media, PlaylistPreview } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { makePdf, makeVideo, png, upload } from '../fixtures.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
});
afterEach(async () => {
  await t.close();
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie: s.cookieA } });

async function up(name: string, data: Buffer): Promise<Media> {
  return (await upload(t.app, s.cookieA, name, data)).json();
}

describe('expandPlaylist', () => {
  it('expands pages, applies ranges and durations, and loops in order', async () => {
    const pdf = await up('deck.pdf', makePdf(4));
    const img = await up('photo.png', await png(40, 30));
    const vid = await up('clip.mp4', await makeVideo());
    await t.pipeline.onIdle();

    const pl = (
      await call('POST', '/api/playlists', { name: 'Lobby', defaultDurationSec: 8 })
    ).json();
    await call('PUT', `/api/playlists/${pl.id}/items`, {
      items: [
        { mediaId: pdf.id, pageFrom: 2, pageTo: 3 },
        { mediaId: img.id, durationSec: 20 },
        { mediaId: vid.id },
        { mediaId: pdf.id, pageFrom: 4, durationSec: 5 },
      ],
    });

    const preview = (
      await call('GET', `/api/playlists/${pl.id}/preview`)
    ).json() as PlaylistPreview;
    expect(preview.transition).toBe('fade');
    expect(
      preview.items.map(({ type, durationSec, mediaId, pageNo }) => ({
        type,
        durationSec,
        mediaId,
        pageNo,
      })),
    ).toEqual([
      { type: 'image', durationSec: 8, mediaId: pdf.id, pageNo: 2 },
      { type: 'image', durationSec: 8, mediaId: pdf.id, pageNo: 3 },
      { type: 'image', durationSec: 20, mediaId: img.id, pageNo: null },
      { type: 'video', durationSec: null, mediaId: vid.id, pageNo: null },
      { type: 'image', durationSec: 5, mediaId: pdf.id, pageNo: 4 },
    ]);
    for (const item of preview.items)
      expect(item.url).toMatch(/^\/media\/[a-f0-9]{64}\.(webp|mp4)$/);
  });

  it('follows the playlist default when it changes', async () => {
    const img = await up('photo.png', await png(40, 30));
    await t.pipeline.onIdle();
    const pl = (await call('POST', '/api/playlists', { name: 'P' })).json();
    await call('PUT', `/api/playlists/${pl.id}/items`, { items: [{ mediaId: img.id }] });
    await call('PATCH', `/api/playlists/${pl.id}`, { defaultDurationSec: 15, transition: 'none' });
    const preview = (
      await call('GET', `/api/playlists/${pl.id}/preview`)
    ).json() as PlaylistPreview;
    expect(preview.transition).toBe('none');
    expect(preview.items[0]!.durationSec).toBe(15);
  });

  it('skips media that is still processing or failed', async () => {
    const good = await up('ok.png', await png(10, 10));
    const bad = await up('bad.pdf', Buffer.from('%PDF-1.4 garbage'));
    await t.pipeline.onIdle();
    const pl = (await call('POST', '/api/playlists', { name: 'P' })).json();
    await call('PUT', `/api/playlists/${pl.id}/items`, {
      items: [{ mediaId: bad.id }, { mediaId: good.id }],
    });
    const preview = (
      await call('GET', `/api/playlists/${pl.id}/preview`)
    ).json() as PlaylistPreview;
    expect(preview.items.map((i) => i.mediaId)).toEqual([good.id]);
  });

  it('validates page ranges and durations', async () => {
    const pl = (await call('POST', '/api/playlists', { name: 'P' })).json();
    const bad = [
      { mediaId: 1, pageFrom: 3, pageTo: 2 },
      { mediaId: 1, durationSec: 0 },
      { mediaId: 1, pageFrom: 0 },
    ];
    for (const item of bad) {
      const res = await call('PUT', `/api/playlists/${pl.id}/items`, { items: [item] });
      expect(res.statusCode, JSON.stringify(item)).toBe(400);
      expect(res.json().error).toBe('bad_request');
    }
  });
});
