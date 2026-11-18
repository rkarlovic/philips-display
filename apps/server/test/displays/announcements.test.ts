/** University announcements: resolver steps 1 and 5, API, pushes, scheduler. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Announcement, Display, Manifest, Media, Playlist } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { png, upload } from '../fixtures.js';
import { connectPlayer, manifestFor, pairDisplay, sleep } from './helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let dA: { display: Display; token: string };
let dA2: { display: Display; token: string };
let dB: { display: Display; token: string };
let ownA: Playlist; // faculty A: 3 images
let ownB: Playlist;
let uniNews: Playlist; // university: 1 image
let uniAlert: Playlist; // university: 1 image
let uniEmpty: Playlist; // university: nothing
const media = new Map<string, number>();

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = (method: Method, url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie } });
const asSuper = (method: Method, url: string, payload?: object) =>
  call(method, url, s.cookieSuper, payload);

/** Local Zagreb wall time (test clock starts 2026-03-01 11:00 local). */
const local = (s: string) => new Date(`${s}:00+01:00`);

async function playlist(cookie: string, name: string, files: string[]) {
  const ids: number[] = [];
  for (const f of files) {
    const m = (
      await upload(t.app, cookie, `${f}.png`, await png(10 + ids.length, 10, '#123456'))
    ).json() as Media;
    media.set(f, m.id);
    ids.push(m.id);
  }
  await t.pipeline.onIdle();
  const pl = (
    await call('POST', '/api/playlists', cookie, { name, defaultDurationSec: 5 })
  ).json() as Playlist;
  await call('PUT', `/api/playlists/${pl.id}/items`, cookie, {
    items: ids.map((mediaId) => ({ mediaId })),
  });
  return pl;
}

const names = (m: Manifest) =>
  m.items.map((i) => [...media.entries()].find(([, id]) => id === i.mediaId)?.[0]);

const announce = async (body: object) => {
  const res = await asSuper('POST', '/api/admin/announcements', {
    startsAt: '2026-03-01T09:00',
    ...body,
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json() as Announcement;
};

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  await t.app.ready();
  ownA = await playlist(s.cookieA, 'Own A', ['a1', 'a2', 'a3']);
  ownB = await playlist(s.cookieB, 'Own B', ['b1']);
  uniNews = await playlist(s.cookieSuper, 'Uni news', ['news']);
  uniAlert = await playlist(s.cookieSuper, 'Uni alert', ['alert']);
  uniEmpty = (await asSuper('POST', '/api/playlists', { name: 'Empty' })).json();
  dA = await pairDisplay(t.app, s.cookieSuper, s.facA, 'A1');
  dA2 = await pairDisplay(t.app, s.cookieSuper, s.facA, 'A2');
  dB = await pairDisplay(t.app, s.cookieSuper, s.facB, 'B1');
  for (const d of [dA, dA2]) {
    await call('PATCH', `/api/displays/${d.display.id}`, s.cookieA, { defaultPlaylistId: ownA.id });
  }
  await call('PATCH', `/api/displays/${dB.display.id}`, s.cookieB, { defaultPlaylistId: ownB.id });
});
afterEach(async () => {
  await t.close();
});

describe('takeover', () => {
  it('replaces everything on targeted displays only, for its time window', async () => {
    await announce({
      title: 'Exam info',
      playlistId: uniAlert.id,
      mode: 'takeover',
      target: { kind: 'faculties', facultyIds: [s.facA] },
      startsAt: '2026-03-01T12:00',
      endsAt: '2026-03-01T13:00',
    });
    t.clock.now = local('2026-03-01T11:59');
    expect(names(await manifestFor(t.app, dA.token))).toEqual(['a1', 'a2', 'a3']);
    t.clock.now = local('2026-03-01T12:00');
    const m = await manifestFor(t.app, dA.token);
    expect(m).toMatchObject({ source: 'takeover', playlistName: 'Uni alert' });
    expect(names(m)).toEqual(['alert']);
    expect(names(await manifestFor(t.app, dA2.token))).toEqual(['alert']);
    expect(names(await manifestFor(t.app, dB.token))).toEqual(['b1']); // other faculty
    t.clock.now = local('2026-03-01T13:00');
    expect(names(await manifestFor(t.app, dA.token))).toEqual(['a1', 'a2', 'a3']);
  });

  it('beats an active schedule; the latest-starting takeover wins; empty ones are skipped', async () => {
    await call('POST', `/api/displays/${dA.display.id}/schedules`, s.cookieA, {
      playlistId: ownA.id,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startTime: '00:00',
      endTime: '00:00',
    });
    await announce({
      title: 'Older',
      playlistId: uniNews.id,
      mode: 'takeover',
      target: { kind: 'all' },
      startsAt: '2026-03-01T09:00',
    });
    await announce({
      title: 'Newer',
      playlistId: uniAlert.id,
      mode: 'takeover',
      target: { kind: 'all' },
      startsAt: '2026-03-01T10:00',
    });
    await announce({
      title: 'Empty',
      playlistId: uniEmpty.id,
      mode: 'takeover',
      target: { kind: 'all' },
      startsAt: '2026-03-01T10:30',
    });
    t.clock.now = local('2026-03-01T11:00');
    const m = await manifestFor(t.app, dA.token);
    expect(names(m)).toEqual(['alert']);
    const d = (await call('GET', `/api/displays/${dA.display.id}`, s.cookieA)).json() as Display;
    expect(d.playing).toMatchObject({
      source: 'takeover',
      takeover: { title: 'Newer', mode: 'takeover' },
    });
  });
});

describe('mix', () => {
  it('inserts every N items, or once per loop; faculty users see it on the card', async () => {
    await announce({
      title: 'News',
      playlistId: uniNews.id,
      mode: 'mix',
      target: { kind: 'displays', displayIds: [dA.display.id] },
      mixEveryNItems: 2,
    });
    t.clock.now = local('2026-03-01T11:00');
    expect(names(await manifestFor(t.app, dA.token))).toEqual(['a1', 'a2', 'news', 'a3']);
    expect(names(await manifestFor(t.app, dA2.token))).toEqual(['a1', 'a2', 'a3']); // not targeted

    await announce({
      title: 'Alert',
      playlistId: uniAlert.id,
      mode: 'mix',
      target: { kind: 'all' },
    });
    expect(names(await manifestFor(t.app, dA.token))).toEqual(['a1', 'a2', 'news', 'a3', 'alert']);
    expect(names(await manifestFor(t.app, dB.token))).toEqual(['b1', 'alert']);

    const d = (await call('GET', `/api/displays/${dA.display.id}`, s.cookieA)).json() as Display;
    expect(d.playing.mixIns.map((m) => m.title)).toEqual(['News', 'Alert']);
    expect(d.playing.source).toBe('default');
  });

  it('a display with nothing of its own plays just the mix-ins', async () => {
    await call('PATCH', `/api/displays/${dB.display.id}`, s.cookieB, { defaultPlaylistId: null });
    t.clock.now = local('2026-03-01T11:00');
    expect((await manifestFor(t.app, dB.token)).source).toBe('idle');
    await announce({ title: 'News', playlistId: uniNews.id, mode: 'mix', target: { kind: 'all' } });
    const m = await manifestFor(t.app, dB.token);
    expect(m.source).toBe('mix');
    expect(names(m)).toEqual(['news']);
  });
});

describe('API', () => {
  it('stores local times in TZ (DST-aware) and reports status', async () => {
    t.clock.now = local('2026-03-01T11:00');
    const a = await announce({
      title: 'Summer',
      playlistId: uniNews.id,
      mode: 'mix',
      target: { kind: 'all' },
      startsAt: '2026-03-30T08:00', // the day after DST starts
      endsAt: '2026-03-30T10:00',
    });
    expect(a).toMatchObject({
      startsAt: '2026-03-30T06:00:00.000Z', // CEST = UTC+2
      startsAtLocal: '2026-03-30T08:00',
      endsAtLocal: '2026-03-30T10:00',
      status: 'scheduled',
      displayCount: 3,
      mixEveryNItems: null,
    });
    t.clock.now = new Date('2026-03-30T07:00:00Z');
    expect(
      ((await asSuper('GET', '/api/admin/announcements')).json() as Announcement[])[0]!.status,
    ).toBe('active');
  });

  it('requires a university playlist, valid targets and times', async () => {
    const base = { title: 'X', mode: 'mix', target: { kind: 'all' }, startsAt: '2026-03-01T09:00' };
    const res1 = await asSuper('POST', '/api/admin/announcements', {
      ...base,
      playlistId: ownA.id,
    });
    expect(res1.json().error).toBe('university_playlist_required');
    const res2 = await asSuper('POST', '/api/admin/announcements', {
      ...base,
      playlistId: uniNews.id,
      target: { kind: 'displays', displayIds: [99999] },
    });
    expect(res2.statusCode).toBe(400);
    const res3 = await asSuper('POST', '/api/admin/announcements', {
      ...base,
      playlistId: uniNews.id,
      endsAt: '2026-03-01T08:00',
    });
    expect(res3.statusCode).toBe(400);
    const res4 = await asSuper('POST', '/api/admin/announcements', {
      ...base,
      playlistId: uniNews.id,
      startsAt: '2026-03-01 09:00',
    });
    expect(res4.statusCode).toBe(400);
  });

  it('end now, edit and delete — audited; playlist in use cannot be deleted', async () => {
    t.clock.now = local('2026-03-01T11:00');
    const a = await announce({
      title: 'Live',
      playlistId: uniAlert.id,
      mode: 'takeover',
      target: { kind: 'all' },
    });
    expect(names(await manifestFor(t.app, dA.token))).toEqual(['alert']);

    const del = await asSuper('DELETE', `/api/playlists/${uniAlert.id}`);
    expect(del.json()).toMatchObject({
      error: 'playlist_in_use',
      usedIn: [{ id: a.id, name: 'Live' }],
    });

    const ended = (
      await asSuper('POST', `/api/admin/announcements/${a.id}/end`)
    ).json() as Announcement;
    expect(ended.status).toBe('ended');
    expect(names(await manifestFor(t.app, dA.token))).toEqual(['a1', 'a2', 'a3']);

    const edited = await asSuper('PATCH', `/api/admin/announcements/${a.id}`, {
      title: 'Renamed',
      endsAt: null,
    });
    expect(edited.json()).toMatchObject({ title: 'Renamed', status: 'active', endsAt: null });

    expect((await asSuper('DELETE', `/api/admin/announcements/${a.id}`)).statusCode).toBe(204);
    const actions = t.db
      .prepare("SELECT action FROM audit_log WHERE entity = 'announcement' ORDER BY id")
      .all()
      .map((r) => (r as { action: string }).action);
    expect(actions).toEqual(['create', 'end', 'update', 'delete']);
  });

  it('a scheduled announcement cannot be "ended"; delete it instead', async () => {
    const a = await announce({
      title: 'Later',
      playlistId: uniNews.id,
      mode: 'mix',
      target: { kind: 'all' },
      startsAt: '2026-04-01T09:00',
    });
    expect((await asSuper('POST', `/api/admin/announcements/${a.id}/end`)).statusCode).toBe(400);
  });
});

describe('live pushes', () => {
  it('creating one pushes to the targeted displays only', async () => {
    t.clock.now = local('2026-03-01T11:00');
    const pA = await connectPlayer(t.app, dA.token, (await manifestFor(t.app, dA.token)).version);
    const pB = await connectPlayer(t.app, dB.token, (await manifestFor(t.app, dB.token)).version);
    await sleep(50);
    await announce({
      title: 'A only',
      playlistId: uniNews.id,
      mode: 'mix',
      target: { kind: 'faculties', facultyIds: [s.facA] },
    });
    await pA.box.next((m) => m.type === 'manifest_changed');
    expect(await pB.box.silent((m) => m.type === 'manifest_changed')).toBe(true);
  });

  it('the scheduler pushes when an announcement starts and ends', async () => {
    t.clock.now = local('2026-03-01T11:00');
    t.app.scheduler.runDue();
    await announce({
      title: 'Noon',
      playlistId: uniAlert.id,
      mode: 'takeover',
      target: { kind: 'displays', displayIds: [dB.display.id] },
      startsAt: '2026-03-01T12:00',
      endsAt: '2026-03-01T12:30',
    });
    const d = (await asSuper('GET', `/api/displays/${dB.display.id}`)).json() as Display;
    expect(d.playing.nextChangeAt).toBe('2026-03-01T11:00:00.000Z'); // 12:00 local

    t.clock.now = local('2026-03-01T12:00');
    expect(t.app.scheduler.runDue()).toEqual([dB.display.id]);
    t.clock.now = local('2026-03-01T12:10');
    expect(t.app.scheduler.runDue()).toEqual([]);
    t.clock.now = local('2026-03-01T12:30');
    expect(t.app.scheduler.runDue()).toEqual([dB.display.id]);
  });
});
