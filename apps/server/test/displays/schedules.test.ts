/** Schedules end to end: API, resolver step 2, and timed pushes by the scheduler. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Display, Media, Playlist, Schedule } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { png, upload } from '../fixtures.js';
import { connectPlayer, manifestFor, pairDisplay, sleep } from './helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;
let display: Display;
let token: string;
let morning: Playlist;
let lunch: Playlist;
let fallback: Playlist;

const asA = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie: s.cookieA } });
/** Local Zagreb time on Monday 2 March 2026 (CET, UTC+1). */
const monday = (hhmm: string) => new Date(`2026-03-02T${hhmm}:00+01:00`);

async function playlistWith(name: string, color: string): Promise<Playlist> {
  const m = (
    await upload(t.app, s.cookieA, `${name}.png`, await png(20, 20, color))
  ).json() as Media;
  await t.pipeline.onIdle();
  const pl = (await asA('POST', '/api/playlists', { name })).json() as Playlist;
  await asA('PUT', `/api/playlists/${pl.id}/items`, { items: [{ mediaId: m.id }] });
  return pl;
}

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  await t.app.ready();
  morning = await playlistWith('Morning', '#ff0000');
  lunch = await playlistWith('Lunch', '#00ff00');
  fallback = await playlistWith('Fallback', '#0000ff');
  ({ display, token } = await pairDisplay(t.app, s.cookieSuper, s.facA, 'Hall'));
  await asA('PATCH', `/api/displays/${display.id}`, { defaultPlaylistId: fallback.id });
});
afterEach(async () => {
  await t.close();
});

const create = (body: object) => asA('POST', `/api/displays/${display.id}/schedules`, body);
const weekdays = [1, 2, 3, 4, 5];

describe('schedule API', () => {
  it('creates, lists (with activeNow), updates and deletes — each audited', async () => {
    t.clock.now = monday('09:00');
    const res = await create({
      playlistId: morning.id,
      weekdays: [5, 1, 1, 3],
      startTime: '08:00',
      endTime: '12:00',
    });
    expect(res.statusCode).toBe(201);
    const sched = res.json() as Schedule;
    expect(sched).toMatchObject({
      weekdays: [1, 3, 5],
      playlistName: 'Morning',
      priority: 0,
      dateFrom: null,
      dateTo: null,
      activeNow: true,
    });

    const list = (await asA('GET', `/api/displays/${display.id}/schedules`)).json() as Schedule[];
    expect(list.map((x) => x.id)).toEqual([sched.id]);

    const upd = await asA('PATCH', `/api/schedules/${sched.id}`, {
      startTime: '10:00',
      dateFrom: '2026-03-01',
    });
    expect(upd.json()).toMatchObject({
      startTime: '10:00',
      endTime: '12:00',
      dateFrom: '2026-03-01',
      activeNow: false,
    });

    expect((await asA('DELETE', `/api/schedules/${sched.id}`)).statusCode).toBe(204);
    const actions = t.db
      .prepare("SELECT action FROM audit_log WHERE entity = 'schedule' ORDER BY id")
      .all()
      .map((r) => (r as { action: string }).action);
    expect(actions).toEqual(['create', 'update', 'delete']);
  });

  it('validates input', async () => {
    const bad = [
      { playlistId: morning.id, weekdays: [], startTime: '08:00', endTime: '12:00' },
      { playlistId: morning.id, weekdays: [8], startTime: '08:00', endTime: '12:00' },
      { playlistId: morning.id, weekdays, startTime: '8:00', endTime: '12:00' },
      { playlistId: morning.id, weekdays, startTime: '24:00', endTime: '12:00' },
      {
        playlistId: morning.id,
        weekdays,
        startTime: '08:00',
        endTime: '12:00',
        dateFrom: '2026-05-02',
        dateTo: '2026-05-01',
      },
      {
        playlistId: morning.id,
        weekdays,
        startTime: '08:00',
        endTime: '12:00',
        dateFrom: '2026-13-01',
      },
      { playlistId: morning.id, weekdays, startTime: '08:00', endTime: '12:00', priority: 1000 },
    ];
    for (const body of bad) expect((await create(body)).statusCode, JSON.stringify(body)).toBe(400);
    const sched = (
      await create({
        playlistId: morning.id,
        weekdays,
        startTime: '08:00',
        endTime: '12:00',
        dateFrom: '2026-05-01',
      })
    ).json();
    const r = await asA('PATCH', `/api/schedules/${sched.id}`, { dateTo: '2026-04-01' });
    expect(r.statusCode).toBe(400);
  });

  it('a playlist used by a schedule cannot be deleted', async () => {
    await create({ playlistId: morning.id, weekdays, startTime: '08:00', endTime: '12:00' });
    const res = await asA('DELETE', `/api/playlists/${morning.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'playlist_in_use',
      usedIn: [{ id: display.id, name: 'Hall' }],
    });
  });
});

describe('what plays when', () => {
  beforeEach(async () => {
    await create({ playlistId: morning.id, weekdays, startTime: '08:00', endTime: '12:00' });
    await create({
      playlistId: lunch.id,
      weekdays,
      startTime: '11:30',
      endTime: '13:00',
      priority: 5,
    });
  });

  it('follows schedules and priorities, else the default playlist', async () => {
    const at = async (iso: Date) => {
      t.clock.now = iso;
      return manifestFor(t.app, token);
    };
    expect(await at(monday('07:59'))).toMatchObject({
      source: 'default',
      playlistName: 'Fallback',
    });
    expect(await at(monday('08:00'))).toMatchObject({
      source: 'schedule',
      playlistName: 'Morning',
    });
    expect(await at(monday('11:45'))).toMatchObject({ source: 'schedule', playlistName: 'Lunch' }); // priority 5 wins
    expect(await at(monday('12:30'))).toMatchObject({ source: 'schedule', playlistName: 'Lunch' });
    expect(await at(monday('13:00'))).toMatchObject({
      source: 'default',
      playlistName: 'Fallback',
    });
    // Saturday: no weekday schedule.
    t.clock.now = new Date('2026-03-07T09:00:00+01:00');
    expect(await manifestFor(t.app, token)).toMatchObject({ source: 'default' });
  });

  it('the admin view says what is playing, until when, and the next change', async () => {
    t.clock.now = monday('09:00');
    const d = (await asA('GET', `/api/displays/${display.id}`)).json() as Display;
    expect(d.scheduleCount).toBe(2);
    expect(d.playing).toMatchObject({
      source: 'schedule',
      playlistName: 'Morning',
      until: '2026-03-02T11:00:00.000Z', // 12:00 local
      nextChangeAt: '2026-03-02T10:30:00.000Z', // lunch starts 11:30 local
    });
  });

  it('with no default playlist and no active schedule, the display is idle', async () => {
    await asA('PATCH', `/api/displays/${display.id}`, { defaultPlaylistId: null });
    t.clock.now = monday('20:00');
    expect(await manifestFor(t.app, token)).toMatchObject({ source: 'idle', items: [] });
  });
});

describe('scheduler', () => {
  it('pushes manifest_changed at a boundary, only to the displays concerned', async () => {
    const other = await pairDisplay(t.app, s.cookieSuper, s.facA, 'Other');
    await asA('PATCH', `/api/displays/${other.display.id}`, { defaultPlaylistId: fallback.id });

    t.clock.now = monday('07:59');
    await create({ playlistId: morning.id, weekdays, startTime: '08:00', endTime: '12:00' });
    t.app.scheduler.runDue(); // establish "last run" at 07:59

    const p1 = await connectPlayer(t.app, token, (await manifestFor(t.app, token)).version);
    const p2 = await connectPlayer(
      t.app,
      other.token,
      (await manifestFor(t.app, other.token)).version,
    );
    await sleep(50);

    t.clock.now = monday('08:00');
    expect(t.app.scheduler.runDue()).toEqual([display.id]);
    const msg = await p1.box.next((m) => m.type === 'manifest_changed');
    expect(msg.version).toBe((await manifestFor(t.app, token)).version);
    expect((await manifestFor(t.app, token)).playlistName).toBe('Morning');
    expect(await p2.box.silent((m) => m.type === 'manifest_changed')).toBe(true);

    // Nothing new between boundaries.
    t.clock.now = monday('10:00');
    expect(t.app.scheduler.runDue()).toEqual([]);

    // A missed boundary (e.g. the server was asleep) is still caught on the next run.
    t.clock.now = monday('12:05');
    expect(t.app.scheduler.runDue()).toEqual([display.id]);
    expect((await manifestFor(t.app, token)).playlistName).toBe('Fallback');
  });

  it('two schedules with the same playlist back to back do not restart the loop', async () => {
    t.clock.now = monday('07:00');
    await create({ playlistId: morning.id, weekdays, startTime: '08:00', endTime: '10:00' });
    await create({ playlistId: morning.id, weekdays, startTime: '10:00', endTime: '12:00' });
    t.clock.now = monday('09:59');
    const v1 = (await manifestFor(t.app, token)).version;
    t.clock.now = monday('10:00');
    const m2 = await manifestFor(t.app, token);
    expect(m2.version).toBe(v1);
  });

  it('a schedule edit is pushed at once', async () => {
    t.clock.now = monday('09:00');
    const p = await connectPlayer(t.app, token, (await manifestFor(t.app, token)).version);
    await sleep(50);
    await create({ playlistId: morning.id, weekdays, startTime: '08:00', endTime: '12:00' });
    await p.box.next((m) => m.type === 'manifest_changed');
  });
});

describe('moving a display to another faculty', () => {
  it('drops its schedules that use the old faculty’s playlists', async () => {
    await create({ playlistId: morning.id, weekdays, startTime: '08:00', endTime: '12:00' });
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/displays/${display.id}`,
      headers: { cookie: s.cookieSuper },
      payload: { facultyId: s.facB },
    });
    expect(res.json()).toMatchObject({ scheduleCount: 0, defaultPlaylistId: null });
  });
});
