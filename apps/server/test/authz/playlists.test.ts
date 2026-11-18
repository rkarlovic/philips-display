/** Cross-faculty access tests for /api/playlists (CLAUDE.md §6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Media, Playlist } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { png, upload } from '../fixtures.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let mediaA: Media;
let mediaB: Media;
let uniMedia: Media;
let plA: Playlist;
let plB: Playlist;
let plUni: Playlist;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie } });

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  mediaA = (await upload(t.app, s.cookieA, 'a.png', await png(10, 10, '#a00000'))).json();
  mediaB = (await upload(t.app, s.cookieB, 'b.png', await png(10, 10, '#00b000'))).json();
  uniMedia = (await upload(t.app, s.cookieSuper, 'u.png', await png(10, 10, '#0000c0'))).json();
  await t.pipeline.onIdle();
  plA = (await call('POST', '/api/playlists', s.cookieA, { name: 'A loop' })).json();
  plB = (await call('POST', '/api/playlists', s.cookieB, { name: 'B loop' })).json();
  plUni = (await call('POST', '/api/playlists', s.cookieSuper, { name: 'Uni loop' })).json();
});
afterEach(async () => {
  await t.close();
});

describe('ownership', () => {
  it('faculty playlists belong to the creator’s faculty, whatever the body says', async () => {
    expect(plA.facultyId).toBe(s.facA);
    const res = await call('POST', '/api/playlists', s.cookieA, { name: 'x', facultyId: s.facB });
    expect(res.json().facultyId).toBe(s.facA);
    const nul = await call('POST', '/api/playlists', s.cookieA, { name: 'y', facultyId: null });
    expect(nul.json().facultyId).toBe(s.facA);
  });

  it('super admin creates university playlists by default', () => {
    expect(plUni.facultyId).toBeNull();
  });
});

describe('visibility', () => {
  it('faculty users list only their own playlists (no other faculty, no university)', async () => {
    const list = (await call('GET', '/api/playlists', s.cookieA)).json() as Playlist[];
    expect(list.map((p) => p.id)).toEqual([plA.id]);
  });

  it('super admin lists all', async () => {
    const list = (await call('GET', '/api/playlists', s.cookieSuper)).json() as Playlist[];
    expect(list.map((p) => p.id).sort()).toEqual([plA.id, plB.id, plUni.id].sort());
  });

  it('other faculty and university playlists are 404 for every route', async () => {
    const routes: [Method, string, object?][] = [];
    for (const id of [plB.id, plUni.id]) {
      routes.push(
        ['GET', `/api/playlists/${id}`],
        ['PATCH', `/api/playlists/${id}`, { name: 'hacked' }],
        ['PUT', `/api/playlists/${id}/items`, { items: [] }],
        ['GET', `/api/playlists/${id}/preview`],
        ['DELETE', `/api/playlists/${id}`],
      );
    }
    for (const [method, url, payload] of routes) {
      const res = await call(method, url, s.cookieA, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const names = t.db.prepare('SELECT name FROM playlists ORDER BY id').all();
    expect(names).toEqual([{ name: 'A loop' }, { name: 'B loop' }, { name: 'Uni loop' }]);
  });
});

describe('which media may go into a playlist', () => {
  const put = (cookie: string, playlistId: number, mediaIds: number[]) =>
    call('PUT', `/api/playlists/${playlistId}/items`, cookie, {
      items: mediaIds.map((mediaId) => ({ mediaId })),
    });

  it('own media and university media: yes', async () => {
    const res = await put(s.cookieA, plA.id, [mediaA.id, uniMedia.id]);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { mediaId: number }) => i.mediaId)).toEqual([
      mediaA.id,
      uniMedia.id,
    ]);
  });

  it("another faculty's media: refused like a missing id", async () => {
    const other = await put(s.cookieA, plA.id, [mediaB.id]);
    const missing = await put(s.cookieA, plA.id, [99999]);
    expect(other.statusCode).toBe(400);
    expect(other.json().error).toBe('media_not_found');
    expect(other.json().error).toBe(missing.json().error);
  });

  it('even the super admin cannot mix faculty media into another faculty or a university playlist', async () => {
    expect((await put(s.cookieSuper, plA.id, [mediaB.id])).statusCode).toBe(400);
    expect((await put(s.cookieSuper, plUni.id, [mediaA.id])).statusCode).toBe(400);
    expect((await put(s.cookieSuper, plUni.id, [uniMedia.id])).statusCode).toBe(200);
  });
});

describe('anonymous', () => {
  it('gets 401', async () => {
    for (const url of [
      '/api/playlists',
      `/api/playlists/${plA.id}`,
      `/api/playlists/${plA.id}/preview`,
    ]) {
      expect((await t.app.inject({ url })).statusCode, url).toBe(401);
    }
  });
});
