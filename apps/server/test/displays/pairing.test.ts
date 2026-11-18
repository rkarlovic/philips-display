import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
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

const startPairing = async () =>
  (await t.app.inject({ method: 'POST', url: '/api/player/pair' })).json() as {
    code: string;
    claim: string;
  };
const pairStatus = (claim: string) =>
  t.app.inject({ url: '/api/player/pair-status', headers: { 'x-pairing-claim': claim } });

describe('pairing', () => {
  it('a new display gets a readable 6-character code and waits', async () => {
    const { code, claim } = await startPairing();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // no 0/O/1/I/L
    const res = await pairStatus(claim);
    expect(res.json()).toEqual({ status: 'pending', code });
    const pending = await t.app.inject({
      url: '/api/admin/displays/pending',
      headers: { cookie: s.cookieSuper },
    });
    expect(pending.json()).toEqual([expect.objectContaining({ code })]);
  });

  it('super admin pairs by code (any case/spacing); the token is handed over exactly once', async () => {
    const { code, claim } = await startPairing();
    const typed = `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/displays/pair',
      headers: { cookie: s.cookieSuper },
      payload: { code: typed, facultyId: s.facA, name: 'Aula', location: 'Hall', rotation: 90 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().display).toMatchObject({
      name: 'Aula',
      location: 'Hall',
      rotation: 90,
      facultyId: s.facA,
      online: false,
    });
    expect(res.json().setupPath).toMatch(/^\/player\/\?token=/);

    const first = await pairStatus(claim);
    expect(first.json().status).toBe('paired');
    const token = first.json().token as string;
    expect(token).toBe(decodeURIComponent(res.json().setupPath.split('token=')[1]));
    expect((await pairStatus(claim)).statusCode).toBe(404); // not handed out twice

    const m = await manifestFor(t.app, token);
    expect(m).toMatchObject({ displayName: 'Aula', facultyName: 'Faculty A', rotation: 90 });

    // Tokens are stored hashed only.
    const row = t.db.prepare('SELECT token_hash, handoff_token, pairing_code FROM displays').get();
    expect(row).toMatchObject({ handoff_token: null, pairing_code: null });
    expect((row as { token_hash: string }).token_hash).not.toBe(token);
  });

  it('rejects unknown codes and bad input', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/displays/pair',
      headers: { cookie: s.cookieSuper },
      payload: { code: 'ZZZZZZ', facultyId: s.facA, name: 'X' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('pairing_code_invalid');
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/admin/displays/pair',
      headers: { cookie: s.cookieSuper },
      payload: { code: 'ABC', facultyId: s.facA, name: 'X' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('forgets pending displays that have not been seen for a day', async () => {
    const { claim } = await startPairing();
    t.clock.now = new Date(t.clock.now.getTime() + 25 * 3600 * 1000);
    await startPairing(); // purge runs here
    expect((await pairStatus(claim)).statusCode).toBe(404);
  });

  it('a wrong or missing token gets 401', async () => {
    for (const authorization of [undefined, 'Bearer nope-nope-nope', 'Basic x']) {
      const res = await t.app.inject({
        url: '/api/player/manifest',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('a new setup token replaces the old one', async () => {
    const { display, token } = await pairDisplay(t.app, s.cookieSuper, s.facA);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/admin/displays/${display.id}/token`,
      headers: { cookie: s.cookieSuper },
    });
    const fresh = decodeURIComponent(res.json().setupPath.split('token=')[1]);
    await expect(manifestFor(t.app, token)).rejects.toThrow('401');
    expect((await manifestFor(t.app, fresh)).displayId).toBe(display.id);
  });

  it('revoking removes the display; its token stops working', async () => {
    const { display, token } = await pairDisplay(t.app, s.cookieSuper, s.facA);
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/displays/${display.id}`,
      headers: { cookie: s.cookieSuper },
    });
    expect(res.statusCode).toBe(204);
    await expect(manifestFor(t.app, token)).rejects.toThrow('401');
    const audit = t.db.prepare("SELECT action FROM audit_log WHERE entity = 'display'").all();
    expect(audit.map((a) => (a as { action: string }).action)).toEqual(['pair', 'revoke']);
  });
});
