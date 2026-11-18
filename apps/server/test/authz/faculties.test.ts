/** Cross-faculty access tests (mandatory for every route, CLAUDE.md §6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
});
afterEach(async () => {
  await t.close();
});

const get = (url: string, cookie?: string) =>
  t.app.inject({ url, headers: cookie ? { cookie } : {} });

describe('GET /api/faculties (faculty-scoped)', () => {
  it('faculty user sees only their own faculty', async () => {
    const a = (await get('/api/faculties', s.cookieA)).json() as { id: number }[];
    expect(a.map((f) => f.id)).toEqual([s.facA]);
    const b = (await get('/api/faculties', s.cookieB)).json() as { id: number }[];
    expect(b.map((f) => f.id)).toEqual([s.facB]);
  });

  it('super admin sees all faculties', async () => {
    const all = (await get('/api/faculties', s.cookieSuper)).json() as { id: number }[];
    expect(all.map((f) => f.id).sort()).toEqual([s.facA, s.facB].sort());
  });

  it('requires login', async () => {
    expect((await get('/api/faculties')).statusCode).toBe(401);
  });
});

describe('GET /api/faculties/:id (faculty-scoped)', () => {
  it('own faculty → 200', async () => {
    const res = await get(`/api/faculties/${s.facA}`, s.cookieA);
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Faculty A');
  });

  it("another faculty's id → 404, same as a missing id (no id leak)", async () => {
    const other = await get(`/api/faculties/${s.facB}`, s.cookieA);
    const missing = await get('/api/faculties/99999', s.cookieA);
    expect(other.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(other.json()).toEqual(missing.json());
  });

  it('super admin can open any faculty', async () => {
    expect((await get(`/api/faculties/${s.facB}`, s.cookieSuper)).statusCode).toBe(200);
  });
});

describe('moving a user to another faculty', () => {
  it('ends their session, and the next login sees only the new faculty', async () => {
    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${s.userA}`,
      headers: { cookie: s.cookieSuper },
      payload: { facultyId: s.facB },
    });
    expect((await get('/api/faculties', s.cookieA)).statusCode).toBe(401);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@uni.test' },
    });
    const cookie = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
    const list = (await get('/api/faculties', cookie)).json() as { id: number }[];
    expect(list.map((f) => f.id)).toEqual([s.facB]);
  });
});
