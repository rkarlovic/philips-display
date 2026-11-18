import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditPage } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from './helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
  // Some activity: 3 playlists in A, 1 in B.
  for (const [cookie, name] of [
    [s.cookieA, 'a1'],
    [s.cookieA, 'a2'],
    [s.cookieA, 'a3'],
    [s.cookieB, 'b1'],
  ] as const) {
    await t.app.inject({
      method: 'POST',
      url: '/api/playlists',
      payload: { name },
      headers: { cookie },
    });
  }
});
afterEach(async () => {
  await t.close();
});

const audit = async (q: string) =>
  (
    await t.app.inject({ url: `/api/admin/audit${q}`, headers: { cookie: s.cookieSuper } })
  ).json() as AuditPage;

describe('audit log', () => {
  it('filters by entity, action, faculty and user, newest first, with faculty names', async () => {
    const pl = await audit('?entity=playlist&action=create');
    expect(pl.entries.map((e) => (e.details as { name: string }).name)).toEqual([
      'b1',
      'a3',
      'a2',
      'a1',
    ]);
    expect(pl.entries[0]).toMatchObject({ facultyName: 'Faculty B', userEmail: 'b@uni.test' });

    const onlyA = await audit(`?entity=playlist&facultyId=${s.facA}`);
    expect(onlyA.entries).toHaveLength(3);
    const byUser = await audit(`?userId=${s.userB}`);
    expect(byUser.entries.map((e) => e.action).sort()).toEqual(['create', 'login']);

    expect(pl.entities).toEqual(expect.arrayContaining(['playlist', 'session']));
    expect(pl.actions).toEqual(expect.arrayContaining(['create', 'login']));
  });

  it('pages with beforeId', async () => {
    const p1 = await audit('?entity=playlist&limit=2');
    expect(p1.entries).toHaveLength(2);
    expect(p1.nextBeforeId).toBe(p1.entries[1]!.id);
    const p2 = await audit(`?entity=playlist&limit=2&beforeId=${p1.nextBeforeId}`);
    expect(p2.entries).toHaveLength(2);
    expect(p2.nextBeforeId).toBeNull();
    const all = [...p1.entries, ...p2.entries].map((e) => e.id);
    expect(new Set(all).size).toBe(4);
  });

  it('rejects odd filter values', async () => {
    const res = await t.app.inject({
      url: "/api/admin/audit?entity=x' OR 1=1",
      headers: { cookie: s.cookieSuper },
    });
    expect(res.statusCode).toBe(400);
  });
});
