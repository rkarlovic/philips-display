/** WebSocket behaviour: auth, targeted pushes, commands, status, admin live view. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Display, DisplayState, Media } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { png, upload } from '../fixtures.js';
import { connectPlayer, inbox, manifestFor, pairDisplay, sleep } from './helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  await t.app.ready();
});
afterEach(async () => {
  await t.close();
});

const asA = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: object) =>
  t.app.inject({ method, url, payload, headers: { cookie: s.cookieA } });

const state = (over: Partial<DisplayState> = {}): DisplayState => ({
  manifestVersion: 'v1',
  itemIndex: 0,
  itemCount: 1,
  mediaId: null,
  pageNo: null,
  paused: false,
  errors: [],
  screen: { width: 1920, height: 1080 },
  ...over,
});

describe('player socket', () => {
  it('closes with 4001 on a bad token, and after revoke', async () => {
    const bad = await connectPlayer(t.app, 'definitely-not-a-token');
    expect((await bad.box.closed()).code).toBe(4001);

    const { display, token } = await pairDisplay(t.app, s.cookieSuper, s.facA);
    const good = await connectPlayer(t.app, token);
    await sleep(50);
    await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/displays/${display.id}`,
      headers: { cookie: s.cookieSuper },
    });
    expect((await good.box.closed()).code).toBe(4001);
  });

  it('a reconnecting player with an old version gets manifest_changed at once', async () => {
    const { token } = await pairDisplay(t.app, s.cookieSuper, s.facA);
    const p = await connectPlayer(t.app, token, 'stale-version');
    const msg = await p.box.next((m) => m.type === 'manifest_changed');
    expect(msg.version).toBe((await manifestFor(t.app, token)).version);

    const current = (await manifestFor(t.app, token)).version;
    const q = await connectPlayer(t.app, token, current);
    expect(await q.box.silent((m) => m.type === 'manifest_changed')).toBe(true);
  });

  it('pushes manifest_changed only to displays whose playlist changed', async () => {
    const img = (await upload(t.app, s.cookieA, 'i.png', await png(20, 20))).json() as Media;
    await t.pipeline.onIdle();
    const pl = (await asA('POST', '/api/playlists', { name: 'P' })).json();
    const one = await pairDisplay(t.app, s.cookieSuper, s.facA, 'One');
    const two = await pairDisplay(t.app, s.cookieSuper, s.facA, 'Two');
    await asA('PATCH', `/api/displays/${one.display.id}`, { defaultPlaylistId: pl.id });

    const p1 = await connectPlayer(t.app, one.token, (await manifestFor(t.app, one.token)).version);
    const p2 = await connectPlayer(t.app, two.token, (await manifestFor(t.app, two.token)).version);
    await sleep(50);

    await asA('PUT', `/api/playlists/${pl.id}/items`, { items: [{ mediaId: img.id }] });
    const msg = await p1.box.next((m) => m.type === 'manifest_changed');
    expect(msg.version).toBe((await manifestFor(t.app, one.token)).version);
    expect(await p2.box.silent((m) => m.type === 'manifest_changed')).toBe(true);
  });

  it('delivers commands to the right display', async () => {
    const one = await pairDisplay(t.app, s.cookieSuper, s.facA, 'One');
    const p = await connectPlayer(t.app, one.token);
    await sleep(50);
    for (const command of ['pause', 'resume', 'next', 'prev', 'reload'] as const) {
      const res = await asA('POST', `/api/displays/${one.display.id}/command`, { command });
      expect(res.json()).toEqual({ delivered: true });
      expect(await p.box.next((m) => m.type === 'command')).toEqual({ type: 'command', command });
    }
    const bad = await asA('POST', `/api/displays/${one.display.id}/command`, {
      command: 'format-c',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('answers ping with pong and stores reported status', async () => {
    const one = await pairDisplay(t.app, s.cookieSuper, s.facA, 'One');
    const img = (await upload(t.app, s.cookieA, 'shown.png', await png(20, 20))).json() as Media;
    await t.pipeline.onIdle();
    const p = await connectPlayer(t.app, one.token);
    await sleep(50);
    p.ws.send(JSON.stringify({ type: 'status', state: state({ mediaId: img.id, paused: true }) }));
    await sleep(100);
    const d = (
      await t.app.inject({ url: `/api/displays/${one.display.id}`, headers: { cookie: s.cookieA } })
    ).json() as Display;
    expect(d).toMatchObject({
      online: true,
      state: expect.objectContaining({ paused: true, mediaId: img.id }),
      nowPlaying: { mediaName: 'shown.png', pageNo: null },
    });

    p.ws.close();
    await sleep(100);
    const after = (
      await t.app.inject({ url: `/api/displays/${one.display.id}`, headers: { cookie: s.cookieA } })
    ).json() as Display;
    expect(after.online).toBe(false);
  });
});

describe('admin live view', () => {
  it('sends display updates only to admins who may see that display', async () => {
    const a = await pairDisplay(t.app, s.cookieSuper, s.facA, 'A');
    const liveA = inbox(await t.app.injectWS('/api/live', { headers: { cookie: s.cookieA } }));
    const liveB = inbox(await t.app.injectWS('/api/live', { headers: { cookie: s.cookieB } }));
    const liveSuper = inbox(
      await t.app.injectWS('/api/live', { headers: { cookie: s.cookieSuper } }),
    );
    await sleep(50);

    await connectPlayer(t.app, a.token);
    const seenByA = await liveA.next((m) => m.type === 'display');
    expect(seenByA.display as Display).toMatchObject({ id: a.display.id, online: true });
    await liveSuper.next((m) => m.type === 'display');
    expect(await liveB.silent((m) => m.type === 'display')).toBe(true);
  });

  it('pending changes go to the super admin only', async () => {
    const liveA = inbox(await t.app.injectWS('/api/live', { headers: { cookie: s.cookieA } }));
    const liveSuper = inbox(
      await t.app.injectWS('/api/live', { headers: { cookie: s.cookieSuper } }),
    );
    await sleep(50);
    await t.app.inject({ method: 'POST', url: '/api/player/pair' });
    await liveSuper.next((m) => m.type === 'pending_changed');
    expect(await liveA.silent((m) => m.type === 'pending_changed')).toBe(true);
  });

  it('refuses sockets without a session', async () => {
    const box = inbox(await t.app.injectWS('/api/live'));
    expect((await box.closed()).code).toBe(4001);
  });
});
