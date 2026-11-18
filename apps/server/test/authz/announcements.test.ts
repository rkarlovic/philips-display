/** Announcements are super admin only (CLAUDE.md §6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Playlist } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let annId: number;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  const pl = (
    await t.app.inject({
      method: 'POST',
      url: '/api/playlists',
      payload: { name: 'Uni' },
      headers: { cookie: s.cookieSuper },
    })
  ).json() as Playlist;
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/announcements',
    headers: { cookie: s.cookieSuper },
    payload: {
      title: 'T',
      playlistId: pl.id,
      mode: 'mix',
      target: { kind: 'all' },
      startsAt: '2026-03-01T09:00',
    },
  });
  annId = res.json().id;
});
afterEach(async () => {
  await t.close();
});

describe('announcement routes', () => {
  type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
  const routes = (): [Method, string, object?][] => [
    ['GET', '/api/admin/announcements'],
    ['POST', '/api/admin/announcements', { title: 'x' }],
    ['PATCH', `/api/admin/announcements/${annId}`, { title: 'hacked' }],
    ['POST', `/api/admin/announcements/${annId}/end`],
    ['DELETE', `/api/admin/announcements/${annId}`],
  ];

  it('refuse faculty users (403) and anonymous (401), and change nothing', async () => {
    for (const [method, url, payload] of routes()) {
      for (const cookie of [s.cookieA, s.cookieB]) {
        const res = await t.app.inject({ method, url, payload, headers: { cookie } });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
      expect((await t.app.inject({ method, url, payload })).statusCode, `${method} ${url}`).toBe(
        401,
      );
    }
    expect(t.db.prepare('SELECT title, ends_at FROM announcements').all()).toEqual([
      { title: 'T', ends_at: null },
    ]);
  });
});
