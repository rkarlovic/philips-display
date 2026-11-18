/** Cross-faculty access tests for /api/media (CLAUDE.md §6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Media } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { png, upload } from '../fixtures.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let mediaA: Media;
let mediaB: Media;
let uni: Media;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  mediaA = (await upload(t.app, s.cookieA, 'a.png', await png(10, 10, '#a00000'))).json();
  mediaB = (await upload(t.app, s.cookieB, 'b.png', await png(10, 10, '#00b000'))).json();
  uni = (await upload(t.app, s.cookieSuper, 'uni.png', await png(10, 10, '#0000c0'))).json();
  await t.pipeline.onIdle();
});
afterEach(async () => {
  await t.close();
});

const call = (method: 'GET' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie } });
const ids = (res: { json: () => unknown }) => (res.json() as Media[]).map((m) => m.id).sort();

describe('ownership on upload', () => {
  it('faculty uploads belong to the uploader’s faculty, whatever the query says', async () => {
    expect(mediaA.facultyId).toBe(s.facA);
    const sneaky = (
      await upload(t.app, s.cookieA, 'x.png', await png(9, 9), `?facultyId=${s.facB}`)
    ).json();
    expect(sneaky.facultyId).toBe(s.facA);
  });

  it('super admin uploads are university media by default, or go to a chosen faculty', async () => {
    expect(uni.facultyId).toBeNull();
    const forB = (
      await upload(t.app, s.cookieSuper, 'y.png', await png(8, 8), `?facultyId=${s.facB}`)
    ).json();
    expect(forB.facultyId).toBe(s.facB);
  });
});

describe('visibility', () => {
  it('faculty users list their own media plus university media', async () => {
    expect(ids(await call('GET', '/api/media', s.cookieA))).toEqual([mediaA.id, uni.id].sort());
    expect(ids(await call('GET', '/api/media', s.cookieB))).toEqual([mediaB.id, uni.id].sort());
  });

  it('owner filter cannot widen the scope', async () => {
    expect(ids(await call('GET', `/api/media?owner=${s.facB}`, s.cookieA))).toEqual([]);
    expect(ids(await call('GET', '/api/media?owner=university', s.cookieA))).toEqual([uni.id]);
  });

  it('super admin sees everything', async () => {
    expect(ids(await call('GET', '/api/media', s.cookieSuper))).toEqual(
      [mediaA.id, mediaB.id, uni.id].sort(),
    );
  });

  it("another faculty's media is 404 for get, rename and delete (same as a missing id)", async () => {
    for (const [method, payload] of [
      ['GET'],
      ['PATCH', { originalName: 'x' }],
      ['DELETE'],
    ] as const) {
      const other = await call(method, `/api/media/${mediaB.id}`, s.cookieA, payload);
      const missing = await call(method, '/api/media/99999', s.cookieA, payload);
      expect(other.statusCode, method).toBe(404);
      expect(other.json()).toEqual(missing.json());
    }
    expect(t.db.prepare('SELECT original_name FROM media WHERE id = ?').get(mediaB.id)).toEqual({
      original_name: 'b.png',
    });
  });
});

describe('university media is read-only for faculty users', () => {
  it('can be read', async () => {
    const res = await call('GET', `/api/media/${uni.id}`, s.cookieA);
    expect(res.statusCode).toBe(200);
    expect(res.json().readOnly).toBe(true);
  });

  it('cannot be renamed or deleted', async () => {
    const r = await call('PATCH', `/api/media/${uni.id}`, s.cookieA, { originalName: 'x' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('read_only');
    expect((await call('DELETE', `/api/media/${uni.id}`, s.cookieA)).statusCode).toBe(403);
  });

  it('is writable for the super admin', async () => {
    const r = await call('PATCH', `/api/media/${uni.id}`, s.cookieSuper, {
      originalName: 'Uni.png',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().readOnly).toBe(false);
  });

  it('usedIn never reveals another faculty’s playlists', async () => {
    const pl = await t.app.inject({
      method: 'POST',
      url: '/api/playlists',
      payload: { name: 'Secret B' },
      headers: { cookie: s.cookieB },
    });
    await t.app.inject({
      method: 'PUT',
      url: `/api/playlists/${pl.json().id}/items`,
      payload: { items: [{ mediaId: uni.id }] },
      headers: { cookie: s.cookieB },
    });
    expect((await call('GET', `/api/media/${uni.id}`, s.cookieA)).json().usedIn).toEqual([]);
    expect((await call('GET', `/api/media/${uni.id}`, s.cookieSuper)).json().usedIn).toHaveLength(
      1,
    );
  });
});

describe('anonymous', () => {
  it('gets 401 everywhere', async () => {
    for (const url of ['/api/media', `/api/media/${mediaA.id}`, '/api/capabilities']) {
      expect((await t.app.inject({ url })).statusCode, url).toBe(401);
    }
    const res = await upload(t.app, '', 'a.png', await png(5, 5));
    expect(res.statusCode).toBe(401);
  });
});
