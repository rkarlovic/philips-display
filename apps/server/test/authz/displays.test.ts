/** Cross-faculty access tests for display routes (CLAUDE.md §6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Display, Playlist } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { pairDisplay } from '../displays/helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let dA: Display;
let dB: Display;
let plA: Playlist;
let plB: Playlist;
let plUni: Playlist;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie } });

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  dA = (await pairDisplay(t.app, s.cookieSuper, s.facA, 'A screen')).display;
  dB = (await pairDisplay(t.app, s.cookieSuper, s.facB, 'B screen')).display;
  plA = (await call('POST', '/api/playlists', s.cookieA, { name: 'A loop' })).json();
  plB = (await call('POST', '/api/playlists', s.cookieB, { name: 'B loop' })).json();
  plUni = (await call('POST', '/api/playlists', s.cookieSuper, { name: 'Uni loop' })).json();
});
afterEach(async () => {
  await t.close();
});

describe('visibility', () => {
  it('faculty users list only their own displays', async () => {
    const list = (await call('GET', '/api/displays', s.cookieA)).json() as Display[];
    expect(list.map((d) => d.id)).toEqual([dA.id]);
    const all = (await call('GET', '/api/displays', s.cookieSuper)).json() as Display[];
    expect(all.map((d) => d.id).sort()).toEqual([dA.id, dB.id].sort());
  });

  it("another faculty's display is 404 for get, patch and command (like a missing id)", async () => {
    const routes: [Method, string, object?][] = [
      ['GET', `/api/displays/${dB.id}`],
      ['PATCH', `/api/displays/${dB.id}`, { defaultPlaylistId: null }],
      ['POST', `/api/displays/${dB.id}/command`, { command: 'next' }],
    ];
    for (const [method, url, payload] of routes) {
      const other = await call(method, url, s.cookieA, payload);
      const missing = await call(method, url.replace(String(dB.id), '99999'), s.cookieA, payload);
      expect(other.statusCode, `${method} ${url}`).toBe(404);
      expect(other.json()).toEqual(missing.json());
    }
    expect(
      t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'command'").get(),
    ).toEqual({ n: 0 });
  });
});

describe('what faculty users may change', () => {
  it('may set their own playlist as default', async () => {
    const res = await call('PATCH', `/api/displays/${dA.id}`, s.cookieA, {
      defaultPlaylistId: plA.id,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ defaultPlaylistId: plA.id, defaultPlaylistName: 'A loop' });
  });

  it("may not use another faculty's playlist, or a university playlist", async () => {
    for (const id of [plB.id, plUni.id, 99999]) {
      const res = await call('PATCH', `/api/displays/${dA.id}`, s.cookieA, {
        defaultPlaylistId: id,
      });
      expect(res.statusCode, String(id)).toBe(400);
      expect(res.json().error).toBe('playlist_not_found');
    }
  });

  it('may not change name, location, rotation, fit or faculty (403)', async () => {
    for (const payload of [
      { name: 'x' },
      { location: 'x' },
      { rotation: 90 },
      { fit: 'cover' },
      { facultyId: s.facB },
    ]) {
      const res = await call('PATCH', `/api/displays/${dA.id}`, s.cookieA, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
    }
  });

  it('may send commands to their displays (audited)', async () => {
    const res = await call('POST', `/api/displays/${dA.id}/command`, s.cookieA, {
      command: 'next',
    });
    expect(res.json()).toEqual({ delivered: false }); // not connected in this test
    const row = t.db
      .prepare("SELECT details_json FROM audit_log WHERE action = 'command'")
      .get() as {
      details_json: string;
    };
    expect(JSON.parse(row.details_json)).toEqual({ command: 'next', delivered: false });
  });
});

describe('super admin', () => {
  it('can use a university playlist on any display, and edit everything', async () => {
    const res = await call('PATCH', `/api/displays/${dA.id}`, s.cookieSuper, {
      defaultPlaylistId: plUni.id,
      name: 'Aula',
      rotation: 180,
      fit: 'cover',
    });
    expect(res.json()).toMatchObject({
      defaultPlaylistId: plUni.id,
      name: 'Aula',
      rotation: 180,
      fit: 'cover',
    });
  });

  it('cannot put one faculty’s playlist on another faculty’s display', async () => {
    const res = await call('PATCH', `/api/displays/${dA.id}`, s.cookieSuper, {
      defaultPlaylistId: plB.id,
    });
    expect(res.json().error).toBe('playlist_not_found');
  });

  it('moving a display to another faculty drops the old faculty’s default playlist', async () => {
    await call('PATCH', `/api/displays/${dA.id}`, s.cookieA, { defaultPlaylistId: plA.id });
    const res = await call('PATCH', `/api/displays/${dA.id}`, s.cookieSuper, { facultyId: s.facB });
    expect(res.json()).toMatchObject({ facultyId: s.facB, defaultPlaylistId: null });
    expect((await call('GET', `/api/displays/${dA.id}`, s.cookieA)).statusCode).toBe(404);
    expect((await call('GET', `/api/displays/${dA.id}`, s.cookieB)).statusCode).toBe(200);
  });

  it('super-admin display routes refuse faculty users (403) and anonymous (401)', async () => {
    const routes: [Method, string, object?][] = [
      ['GET', '/api/admin/displays/pending'],
      ['POST', '/api/admin/displays/pair', { code: 'ABCDEF', facultyId: s.facA, name: 'x' }],
      ['POST', `/api/admin/displays/${dA.id}/token`],
      ['DELETE', `/api/admin/displays/${dA.id}`],
    ];
    for (const [method, url, payload] of routes) {
      expect((await call(method, url, s.cookieA, payload)).statusCode, `${method} ${url}`).toBe(
        403,
      );
      expect((await t.app.inject({ method, url, payload })).statusCode, `${method} ${url}`).toBe(
        401,
      );
    }
  });
});

describe('deleting things a display uses', () => {
  it('a playlist that is a display default cannot be deleted', async () => {
    await call('PATCH', `/api/displays/${dA.id}`, s.cookieA, { defaultPlaylistId: plA.id });
    const res = await call('DELETE', `/api/playlists/${plA.id}`, s.cookieA);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'playlist_in_use',
      usedIn: [{ id: dA.id, name: 'A screen' }],
    });
  });

  it('a faculty with displays cannot be deleted', async () => {
    t.db.prepare('DELETE FROM playlists WHERE faculty_id = ?').run(s.facA);
    t.db.prepare('UPDATE users SET faculty_id = ? WHERE faculty_id = ?').run(s.facB, s.facA);
    const res = await call('DELETE', `/api/admin/faculties/${s.facA}`, s.cookieSuper);
    expect(res.json().error).toBe('faculty_not_empty');
  });
});
