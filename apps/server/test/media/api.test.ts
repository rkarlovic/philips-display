import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Media } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { makePdf, png, upload } from '../fixtures.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp({ maxUploadMb: 1 });
  s = await seedTwoFaculties(t);
});
afterEach(async () => {
  await t.close();
});

const call = (
  method: 'GET' | 'PATCH' | 'DELETE' | 'PUT' | 'POST',
  url: string,
  cookie: string,
  payload?: object,
) => t.app.inject({ method, url, payload, headers: { cookie } });

describe('upload validation', () => {
  it('rejects unknown extensions', async () => {
    const res = await upload(t.app, s.cookieA, 'notes.txt', Buffer.from('hello'));
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('unsupported_file');
  });

  it('rejects content that does not match the extension', async () => {
    const res = await upload(t.app, s.cookieA, 'fake.pdf', await png(10, 10));
    expect(res.statusCode).toBe(415);
  });

  it('rejects files over MAX_UPLOAD_MB and leaves nothing behind', async () => {
    const big = Buffer.concat([makePdf(1), Buffer.alloc(1.5 * 1024 * 1024)]);
    const res = await upload(t.app, s.cookieA, 'big.pdf', big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('file_too_large');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM media').get()).toEqual({ n: 0 });
  });

  it('enforces the faculty storage quota', async () => {
    // Faculty B has a 1000 MB quota; shrink it to 1 MB and fill it.
    t.db.prepare('UPDATE faculties SET storage_quota_mb = 1 WHERE id = ?').run(s.facB);
    const almostFull = Buffer.concat([makePdf(1), Buffer.alloc(700 * 1024)]);
    expect((await upload(t.app, s.cookieB, 'a.pdf', almostFull)).statusCode).toBe(202);
    const res = await upload(t.app, s.cookieB, 'b.pdf', almostFull);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('quota_exceeded');
    const fac = await call('GET', `/api/faculties/${s.facB}`, s.cookieB);
    expect(fac.json().usedBytes).toBe(almostFull.length);
  });

  it('never uses the client file name as a path', async () => {
    const res = await upload(t.app, s.cookieA, '..\\..\\evil/../poster.png', await png(10, 10));
    expect(res.statusCode).toBe(202);
    expect(res.json().originalName).toBe('poster.png');
  });
});

describe('managing media', () => {
  it('renames, audits, and lists newest first', async () => {
    const a = (await upload(t.app, s.cookieA, 'a.png', await png(10, 10))).json() as Media;
    const b = (await upload(t.app, s.cookieA, 'b.png', await png(11, 11))).json() as Media;
    await t.pipeline.onIdle();
    const renamed = await call('PATCH', `/api/media/${a.id}`, s.cookieA, {
      originalName: 'Welcome.png',
    });
    expect(renamed.json().originalName).toBe('Welcome.png');
    const list = (await call('GET', '/api/media', s.cookieA)).json() as Media[];
    expect(list.map((m) => m.id)).toEqual([b.id, a.id]);
    const actions = t.db
      .prepare("SELECT action FROM audit_log WHERE entity = 'media' ORDER BY id")
      .all()
      .map((r) => (r as { action: string }).action);
    expect(actions).toEqual(['create', 'create', 'update']);
  });

  it('refuses to delete media used in a playlist and says where', async () => {
    const m = (await upload(t.app, s.cookieA, 'a.png', await png(10, 10))).json() as Media;
    await t.pipeline.onIdle();
    const pl = (await call('POST', '/api/playlists', s.cookieA, { name: 'Lobby' })).json();
    await call('PUT', `/api/playlists/${pl.id}/items`, s.cookieA, { items: [{ mediaId: m.id }] });

    const res = await call('DELETE', `/api/media/${m.id}`, s.cookieA);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'media_in_use',
      usedIn: [{ id: pl.id, name: 'Lobby' }],
    });

    const detail = await call('GET', `/api/media/${m.id}`, s.cookieA);
    expect(detail.json().usedIn).toEqual([{ id: pl.id, name: 'Lobby' }]);

    await call('PUT', `/api/playlists/${pl.id}/items`, s.cookieA, { items: [] });
    expect((await call('DELETE', `/api/media/${m.id}`, s.cookieA)).statusCode).toBe(204);
  });

  it('refuses to delete a faculty that still has media', async () => {
    await upload(t.app, s.cookieA, 'a.png', await png(10, 10));
    await t.pipeline.onIdle();
    t.db.prepare('UPDATE users SET faculty_id = ? WHERE id = ?').run(s.facB, s.userA);
    const res = await call('DELETE', `/api/admin/faculties/${s.facA}`, s.cookieSuper);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('faculty_not_empty');
  });
});
