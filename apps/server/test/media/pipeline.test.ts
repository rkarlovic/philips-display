/** End-to-end media pipeline: upload → background processing → ready files. */
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Media, MediaDetail } from '@slidecast/shared';
import { createTestApp, seedTwoFaculties, type TestApp } from '../helpers.js';
import { makePdf, makePptx, makeVideo, png, soffice, upload } from '../fixtures.js';

let t: TestApp;
let s: Awaited<ReturnType<typeof seedTwoFaculties>>;

beforeEach(async () => {
  t = await createTestApp({ soffice });
  s = await seedTwoFaculties(t);
});
afterEach(async () => {
  await t.close();
});

async function uploadAndWait(name: string, data: Buffer, cookie = s.cookieA) {
  const res = await upload(t.app, cookie, name, data);
  expect(res.statusCode, res.body).toBe(202);
  const created = res.json() as Media;
  expect(created.status).toBe('processing');
  await t.pipeline.onIdle();
  const detail = await t.app.inject({ url: `/api/media/${created.id}`, headers: { cookie } });
  return detail.json() as MediaDetail;
}

const fileOf = (url: string) => t.store.pathOf(url.replace('/media/', ''));

describe('images', () => {
  it('converts to WebP with a thumbnail', async () => {
    const m = await uploadAndWait('poster.png', await png(800, 600));
    expect(m).toMatchObject({ status: 'ready', kind: 'image', pageCount: 1, error: null });
    expect(m.pages[0]).toMatchObject({ width: 800, height: 600 });
    const meta = await sharp(fileOf(m.pages[0]!.url)).metadata();
    expect(meta.format).toBe('webp');
    expect(m.thumbUrl).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);
  });

  it('caps landscape images at 3840×2160 and portrait at 2160×3840', async () => {
    const wide = await uploadAndWait('wide.png', await png(5000, 1000));
    expect(wide.pages[0]).toMatchObject({ width: 3840, height: 768 });
    const tall = await uploadAndWait('tall.png', await png(1000, 5000));
    expect(tall.pages[0]).toMatchObject({ width: 768, height: 3840 });
  });

  it('serves files content-addressed with immutable caching', async () => {
    const m = await uploadAndWait('a.png', await png(100, 100));
    const res = await t.app.inject({ url: m.pages[0]!.url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('stores identical content once and keeps it until the last user is deleted', async () => {
    const data = await png(120, 80, '#ff0000');
    const one = await uploadAndWait('one.png', data);
    const two = await uploadAndWait('two.png', data);
    expect(one.pages[0]!.url).toBe(two.pages[0]!.url);
    const file = fileOf(one.pages[0]!.url);

    await t.app.inject({
      method: 'DELETE',
      url: `/api/media/${one.id}`,
      headers: { cookie: s.cookieA },
    });
    expect(fs.existsSync(file)).toBe(true);
    await t.app.inject({
      method: 'DELETE',
      url: `/api/media/${two.id}`,
      headers: { cookie: s.cookieA },
    });
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('PDF', () => {
  it('renders one image per page', async () => {
    const m = await uploadAndWait('slides.pdf', makePdf(3));
    expect(m).toMatchObject({ status: 'ready', kind: 'pdf', pageCount: 3 });
    expect(m.pages.map((p) => p.pageNo)).toEqual([1, 2, 3]);
    // Letter at 72 dpi (test setting) = 612×792
    expect(m.pages[0]).toMatchObject({ width: 612, height: 792 });
    const meta = await sharp(fileOf(m.pages[1]!.url)).metadata();
    expect(meta.format).toBe('webp');
  });

  it('caps the long edge at 3840 px even at a high DPI', async () => {
    await t.close();
    t = await createTestApp({ pdfDpi: 600 });
    s = await seedTwoFaculties(t);
    const m = await uploadAndWait('big.pdf', makePdf(1));
    expect(m.pages[0]!.height).toBe(3840);
    expect(m.pages[0]!.width).toBe(Math.floor(612 * (3840 / 792)));
  });

  it('marks a damaged PDF as failed (corrupt)', async () => {
    const m = await uploadAndWait('broken.pdf', Buffer.from('%PDF-1.4\nthis is not a pdf'));
    expect(m).toMatchObject({ status: 'failed', error: 'corrupt', pageCount: 0 });
  });
});

describe('video', () => {
  it('stores H.264 MP4 as-is with duration and a poster thumbnail', async () => {
    const m = await uploadAndWait('clip.mp4', await makeVideo('libx264'));
    expect(m).toMatchObject({ status: 'ready', kind: 'video', pageCount: 0 });
    expect(m.durationSec).toBeCloseTo(2, 0);
    expect(m.videoUrl).toMatch(/^\/media\/[a-f0-9]{64}\.mp4$/);
    expect(m.thumbUrl).toMatch(/\.webp$/);
    expect(fs.existsSync(fileOf(m.videoUrl!))).toBe(true);
  });

  it('rejects codecs other than H.264', async () => {
    const m = await uploadAndWait('old.mp4', await makeVideo('mpeg4'));
    expect(m).toMatchObject({ status: 'failed', error: 'video_codec' });
  });
});

describe('PowerPoint', () => {
  it.skipIf(!soffice)(
    'converts slides to pages via LibreOffice',
    async () => {
      const m = await uploadAndWait('deck.pptx', await makePptx());
      expect(m).toMatchObject({ status: 'ready', kind: 'pptx', pageCount: 2 });
    },
    180_000,
  );

  it('is refused when LibreOffice is missing', async () => {
    await t.close();
    t = await createTestApp({ soffice: null });
    s = await seedTwoFaculties(t);
    const caps = await t.app.inject({ url: '/api/capabilities', headers: { cookie: s.cookieA } });
    expect(caps.json()).toMatchObject({ pptx: false });
    expect(caps.json().acceptedExtensions).not.toContain('.pptx');
    // Any ZIP with a .pptx name is enough to hit the check.
    const res = await upload(t.app, s.cookieA, 'deck.pptx', Buffer.from('PK\u0003\u0004rest'));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('pptx_unavailable');
  });
});

describe('restart recovery', () => {
  it('fails media whose original vanished while processing', async () => {
    t.db
      .prepare(
        "INSERT INTO media (faculty_id, kind, original_name, size, status) VALUES (?, 'pdf', 'x.pdf', 1, 'processing')",
      )
      .run(s.facA);
    t.pipeline.recover();
    const row = t.db.prepare("SELECT status, error FROM media WHERE original_name = 'x.pdf'").get();
    expect(row).toEqual({ status: 'failed', error: 'interrupted' });
  });
});
