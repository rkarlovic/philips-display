import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedTwoFaculties, type TestApp } from './helpers.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp();
  s = await seedTwoFaculties(t);
});
afterEach(async () => {
  await t.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, payload, headers: { cookie: s.cookieSuper } });

const auditActions = () =>
  t.db
    .prepare("SELECT action, entity, entity_id FROM audit_log WHERE action != 'login' ORDER BY id")
    .all();

describe('faculties', () => {
  it('create, rename, set quota, delete — each audited', async () => {
    const created = await call('POST', '/api/admin/faculties', { name: '  Faculty C ' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;
    expect(created.json()).toMatchObject({ name: 'Faculty C', storageQuotaMb: null, userCount: 0 });

    const upd = await call('PATCH', `/api/admin/faculties/${id}`, {
      name: 'Faculty C2',
      storageQuotaMb: 2048,
    });
    expect(upd.json()).toMatchObject({ name: 'Faculty C2', storageQuotaMb: 2048 });

    const clear = await call('PATCH', `/api/admin/faculties/${id}`, { storageQuotaMb: null });
    expect(clear.json()).toMatchObject({ name: 'Faculty C2', storageQuotaMb: null });

    expect((await call('DELETE', `/api/admin/faculties/${id}`)).statusCode).toBe(204);
    expect(auditActions()).toEqual([
      { action: 'create', entity: 'faculty', entity_id: String(id) },
      { action: 'update', entity: 'faculty', entity_id: String(id) },
      { action: 'update', entity: 'faculty', entity_id: String(id) },
      { action: 'delete', entity: 'faculty', entity_id: String(id) },
    ]);
  });

  it('rejects duplicate names (case-insensitive)', async () => {
    const res = await call('POST', '/api/admin/faculties', { name: 'faculty a' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('faculty_name_taken');
  });

  it('refuses to delete a faculty that has users', async () => {
    const res = await call('DELETE', `/api/admin/faculties/${s.facA}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('faculty_has_users');
  });

  it('validates input', async () => {
    expect((await call('POST', '/api/admin/faculties', { name: '' })).statusCode).toBe(400);
    expect(
      (await call('POST', '/api/admin/faculties', { name: 'X', storageQuotaMb: -1 })).statusCode,
    ).toBe(400);
    expect((await call('PATCH', '/api/admin/faculties/abc', { name: 'X' })).statusCode).toBe(400);
    expect((await call('PATCH', '/api/admin/faculties/9999', { name: 'X' })).statusCode).toBe(404);
  });
});

describe('users', () => {
  it('creates a faculty user (email stored lowercase) and audits it', async () => {
    const res = await call('POST', '/api/admin/users', {
      email: 'New@Uni.Test',
      displayName: 'New',
      facultyId: s.facA,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      email: 'new@uni.test',
      facultyId: s.facA,
      role: 'faculty_user',
      active: true,
      locale: 'hr',
    });
    expect(auditActions()).toContainEqual({
      action: 'create',
      entity: 'user',
      entity_id: String(res.json().id),
    });
  });

  it('rejects a duplicate email, including the super admin email', async () => {
    expect(
      (await call('POST', '/api/admin/users', { email: 'A@uni.test', facultyId: s.facB })).json()
        .error,
    ).toBe('email_taken');
    expect(
      (await call('POST', '/api/admin/users', { email: 'it@uni.test', facultyId: s.facB })).json()
        .error,
    ).toBe('email_taken');
  });

  it('rejects an unknown faculty', async () => {
    const res = await call('POST', '/api/admin/users', { email: 'z@uni.test', facultyId: 9999 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('faculty_not_found');
  });

  it('lists faculty users, filterable by faculty, without the super admin', async () => {
    const all = (await call('GET', '/api/admin/users')).json() as { email: string }[];
    expect(all.map((u) => u.email)).toEqual(['a@uni.test', 'b@uni.test']);
    const onlyB = (await call('GET', `/api/admin/users?facultyId=${s.facB}`)).json() as {
      email: string;
    }[];
    expect(onlyB.map((u) => u.email)).toEqual(['b@uni.test']);
  });

  it('deactivates and reactivates', async () => {
    expect(
      (await call('PATCH', `/api/admin/users/${s.userA}`, { active: false })).json().active,
    ).toBe(false);
    expect(
      (await call('PATCH', `/api/admin/users/${s.userA}`, { active: true })).json().active,
    ).toBe(true);
  });
});
