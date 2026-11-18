import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Media } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { makePdf, png, upload } from '../fixtures.js';
import { manifestFor, pairDisplay } from './helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
});
afterEach(async () => {
  await t.close();
});

const asA = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: object) =>
  t.app.inject({ method, url, payload, headers: { cookie: s.cookieA } });

describe('resolveManifest', () => {
  it('no default playlist → idle screen (faculty name + clock)', async () => {
    const { token } = await pairDisplay(t.app, s.cookieSuper, s.facA);
    const m = await manifestFor(t.app, token);
    expect(m).toMatchObject({
      source: 'idle',
      items: [],
      facultyName: 'Faculty A',
      timezone: 'Europe/Zagreb',
      playlistId: null,
    });
  });

  it('default playlist → its expanded loop, with display rotation/fit and playlist transition', async () => {
    const pdf = (await upload(t.app, s.cookieA, 'd.pdf', makePdf(2))).json() as Media;
    const img = (await upload(t.app, s.cookieA, 'i.png', await png(20, 20))).json() as Media;
    await t.pipeline.onIdle();
    const pl = (await asA('POST', '/api/playlists', { name: 'Hall', transition: 'none' })).json();
    await asA('PUT', `/api/playlists/${pl.id}/items`, {
      items: [{ mediaId: pdf.id }, { mediaId: img.id, durationSec: 4 }],
    });
    const { display, token } = await pairDisplay(t.app, s.cookieSuper, s.facA, 'Hall', {
      rotation: 270,
      fit: 'cover',
    });
    await asA('PATCH', `/api/displays/${display.id}`, { defaultPlaylistId: pl.id });

    const m = await manifestFor(t.app, token);
    expect(m).toMatchObject({
      source: 'playlist',
      playlistName: 'Hall',
      rotation: 270,
      fit: 'cover',
      transition: 'none',
    });
    expect(m.items.map((i) => [i.mediaId, i.pageNo, i.durationSec])).toEqual([
      [pdf.id, 1, 10],
      [pdf.id, 2, 10],
      [img.id, null, 4],
    ]);
  });

  it('the version changes exactly when the manifest content changes', async () => {
    const img = (await upload(t.app, s.cookieA, 'i.png', await png(20, 20))).json() as Media;
    await t.pipeline.onIdle();
    const pl = (await asA('POST', '/api/playlists', { name: 'P' })).json();
    await asA('PUT', `/api/playlists/${pl.id}/items`, { items: [{ mediaId: img.id }] });
    const { display, token } = await pairDisplay(t.app, s.cookieSuper, s.facA);
    await asA('PATCH', `/api/displays/${display.id}`, { defaultPlaylistId: pl.id });

    const v1 = (await manifestFor(t.app, token)).version;
    expect((await manifestFor(t.app, token)).version).toBe(v1);
    await asA('PATCH', `/api/playlists/${pl.id}`, { defaultDurationSec: 30 });
    const v2 = (await manifestFor(t.app, token)).version;
    expect(v2).not.toBe(v1);
    // Renaming media doesn't change what is played.
    await asA('PATCH', `/api/media/${img.id}`, { originalName: 'renamed.png' } as object);
    expect((await manifestFor(t.app, token)).version).toBe(v2);
  });
});
