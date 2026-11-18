/** Cross-faculty access tests for schedule routes (CLAUDE.md §6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Display, Playlist, Schedule } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { pairDisplay } from '../displays/helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let dA: Display;
let dB: Display;
let plA: Playlist;
let plB: Playlist;
let plUni: Playlist;
let schedB: Schedule;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie } });
const body = (playlistId: number) => ({
  playlistId,
  weekdays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  endTime: '12:00',
});

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  dA = (await pairDisplay(t.app, s.cookieSuper, s.facA, 'A')).display;
  dB = (await pairDisplay(t.app, s.cookieSuper, s.facB, 'B')).display;
  plA = (await call('POST', '/api/playlists', s.cookieA, { name: 'A' })).json();
  plB = (await call('POST', '/api/playlists', s.cookieB, { name: 'B' })).json();
  plUni = (await call('POST', '/api/playlists', s.cookieSuper, { name: 'Uni' })).json();
  schedB = (await call('POST', `/api/displays/${dB.id}/schedules`, s.cookieB, body(plB.id))).json();
});
afterEach(async () => {
  await t.close();
});

describe('schedules of another faculty are invisible (404 like a missing id)', () => {
  it('for every route', async () => {
    const routes: [Method, string, object?][] = [
      ['GET', `/api/displays/${dB.id}/schedules`],
      ['POST', `/api/displays/${dB.id}/schedules`, body(plA.id)],
      ['PATCH', `/api/schedules/${schedB.id}`, { startTime: '09:00' }],
      ['DELETE', `/api/schedules/${schedB.id}`],
    ];
    for (const [method, url, payload] of routes) {
      const other = await call(method, url, s.cookieA, payload);
      const missing = await call(
        method,
        url.replace(/\/\d+(\/|$)/, '/99999$1'),
        s.cookieA,
        payload,
      );
      expect(other.statusCode, `${method} ${url}`).toBe(404);
      expect(other.json()).toEqual(missing.json());
    }
    const row = t.db.prepare('SELECT start_time FROM schedules WHERE id = ?').get(schedB.id);
    expect(row).toEqual({ start_time: '08:00' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM schedules').get()).toEqual({ n: 1 });
  });

  it('anonymous gets 401', async () => {
    expect((await t.app.inject({ url: `/api/displays/${dA.id}/schedules` })).statusCode).toBe(401);
  });
});

describe('which playlists a schedule may use', () => {
  it("faculty users: own playlists only (not another faculty's, not university)", async () => {
    expect(
      (await call('POST', `/api/displays/${dA.id}/schedules`, s.cookieA, body(plA.id))).statusCode,
    ).toBe(201);
    for (const id of [plB.id, plUni.id]) {
      const res = await call('POST', `/api/displays/${dA.id}/schedules`, s.cookieA, body(id));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('playlist_not_found');
    }
    const mine = (
      await call('GET', `/api/displays/${dA.id}/schedules`, s.cookieA)
    ).json() as Schedule[];
    const patch = await call('PATCH', `/api/schedules/${mine[0]!.id}`, s.cookieA, {
      playlistId: plB.id,
    });
    expect(patch.json().error).toBe('playlist_not_found');
  });

  it('super admin: university playlists yes, cross-faculty no', async () => {
    expect(
      (await call('POST', `/api/displays/${dA.id}/schedules`, s.cookieSuper, body(plUni.id)))
        .statusCode,
    ).toBe(201);
    const res = await call('POST', `/api/displays/${dA.id}/schedules`, s.cookieSuper, body(plB.id));
    expect(res.json().error).toBe('playlist_not_found');
  });
});
