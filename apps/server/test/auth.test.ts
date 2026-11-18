import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SUPER_EMAIL,
  SUPER_PASSWORD,
  createTestApp,
  login,
  seedTwoFaculties,
  type TestApp,
} from './helpers.js';
import { SESSION_TTL_MS } from '../src/auth/sessions.js';
import { ensureSuperAdmin } from '../src/auth/email-provider.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
  t.db.close();
});

const loginReq = (payload: object) =>
  t.app.inject({ method: 'POST', url: '/api/auth/login', payload });

describe('email login', () => {
  it('logs in a registered faculty user by email only (case-insensitive)', async () => {
    const s = await seedTwoFaculties(t);
    const res = await loginReq({ email: '  A@Uni.Test ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: s.userA,
      role: 'faculty_user',
      facultyId: s.facA,
      facultyName: 'Faculty A',
    });
    const cookie = res.cookies.find((c) => c.name === 'sid');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  });

  it('rejects unknown email with not_registered', async () => {
    const res = await loginReq({ email: 'nobody@uni.test' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('not_registered');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await loginReq({ email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
  });

  it('rejects deactivated users and ends their sessions', async () => {
    const s = await seedTwoFaculties(t);
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${s.userA}`,
      headers: { cookie: s.cookieSuper },
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);
    expect((await loginReq({ email: 'a@uni.test' })).json().error).toBe('not_registered');
    const me = await t.app.inject({ url: '/api/auth/me', headers: { cookie: s.cookieA } });
    expect(me.statusCode).toBe(401);
  });
});

describe('super admin login', () => {
  it('requires a password', async () => {
    const res = await loginReq({ email: SUPER_EMAIL });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('password_required');
  });

  it('rejects a wrong password', async () => {
    const res = await loginReq({ email: SUPER_EMAIL, password: 'wrong-password' });
    expect(res.json().error).toBe('invalid_credentials');
  });

  it('accepts the env password', async () => {
    const cookie = await login(t.app, SUPER_EMAIL, SUPER_PASSWORD);
    const me = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ email: SUPER_EMAIL, role: 'super_admin', facultyId: null });
  });

  it('picks up a changed env password and drops old sessions', async () => {
    const cookie = await login(t.app, SUPER_EMAIL, SUPER_PASSWORD);
    await ensureSuperAdmin(t.db, SUPER_EMAIL, 'a-brand-new-password');
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
    expect((await loginReq({ email: SUPER_EMAIL, password: SUPER_PASSWORD })).statusCode).toBe(401);
    expect(
      (await loginReq({ email: SUPER_EMAIL, password: 'a-brand-new-password' })).statusCode,
    ).toBe(200);
  });

  it('refuses a SUPERADMIN_EMAIL that belongs to a faculty user', async () => {
    await seedTwoFaculties(t);
    await expect(ensureSuperAdmin(t.db, 'a@uni.test', 'whatever-pw')).rejects.toThrow(
      /faculty user/,
    );
  });
});

describe('sessions', () => {
  it('me returns 401 without a cookie', async () => {
    const res = await t.app.inject({ url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('ignores a tampered cookie', async () => {
    await seedTwoFaculties(t);
    const res = await t.app.inject({
      url: '/api/auth/me',
      headers: { cookie: 'sid=forged.value' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logout ends the session', async () => {
    const s = await seedTwoFaculties(t);
    const out = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: s.cookieA },
    });
    expect(out.statusCode).toBe(204);
    expect(
      (await t.app.inject({ url: '/api/auth/me', headers: { cookie: s.cookieA } })).statusCode,
    ).toBe(401);
  });

  it('sessions expire', async () => {
    const s = await seedTwoFaculties(t);
    t.clock.now = new Date(t.clock.now.getTime() + SESSION_TTL_MS + 1000);
    expect(
      (await t.app.inject({ url: '/api/auth/me', headers: { cookie: s.cookieA } })).statusCode,
    ).toBe(401);
  });

  it('stores the chosen locale', async () => {
    const s = await seedTwoFaculties(t);
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie: s.cookieA },
      payload: { locale: 'en' },
    });
    expect(res.json().locale).toBe('en');
    expect(
      (await t.app.inject({ url: '/api/auth/me', headers: { cookie: s.cookieA } })).json().locale,
    ).toBe('en');
  });

  it('writes login to the audit log', async () => {
    const s = await seedTwoFaculties(t);
    const res = await t.app.inject({ url: '/api/admin/audit', headers: { cookie: s.cookieSuper } });
    const logins = (res.json() as { action: string; userId: number }[]).filter(
      (e) => e.action === 'login',
    );
    expect(logins.map((e) => e.userId)).toEqual(expect.arrayContaining([s.userA, s.userB]));
  });
});
