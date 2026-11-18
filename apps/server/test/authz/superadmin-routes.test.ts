/** Every super-admin route must refuse faculty users and anonymous callers. */
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const routes = (): [Method, string, object?][] => [
  ['GET', '/api/admin/faculties'],
  ['POST', '/api/admin/faculties', { name: 'Hacked' }],
  ['PATCH', `/api/admin/faculties/${s.facA}`, { name: 'Renamed' }],
  ['DELETE', `/api/admin/faculties/${s.facA}`],
  ['GET', '/api/admin/users'],
  ['POST', '/api/admin/users', { email: 'x@uni.test', facultyId: s.facA }],
  ['PATCH', `/api/admin/users/${s.userA}`, { displayName: 'x' }],
  ['GET', '/api/admin/audit'],
];

describe('super admin routes', () => {
  it('refuse faculty users with 403 and change nothing', async () => {
    for (const [method, url, payload] of routes()) {
      for (const cookie of [s.cookieA, s.cookieB]) {
        const res = await t.app.inject({ method, url, payload, headers: { cookie } });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
    }
    const names = t.db.prepare('SELECT name FROM faculties ORDER BY id').all();
    expect(names).toEqual([{ name: 'Faculty A' }, { name: 'Faculty B' }]);
    expect(
      t.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'x@uni.test'").get(),
    ).toEqual({ n: 0 });
  });

  it('refuse anonymous callers with 401', async () => {
    for (const [method, url, payload] of routes()) {
      const res = await t.app.inject({ method, url, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('the super admin row is not editable through the users API', async () => {
    const superId = (
      t.db.prepare("SELECT id FROM users WHERE role = 'super_admin'").get() as { id: number }
    ).id;
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${superId}`,
      headers: { cookie: s.cookieSuper },
      payload: { active: false },
    });
    // Even the super admin can't edit that row through the users API: it's managed via env.
    expect(res.statusCode).toBe(404);
  });
});
