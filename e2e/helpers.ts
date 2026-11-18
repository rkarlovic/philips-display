import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Display, Faculty, Media, PlaylistDetail } from '@slidecast/shared';
import { SUPER } from '../playwright.config.js';
// Reuse the server test fixtures (sharp + ffmpeg-static resolve from apps/server).
import { makeVideo, png } from '../apps/server/test/fixtures.js';

export { makeVideo, png };

export async function loginSuper(api: APIRequestContext): Promise<void> {
  const res = await api.post('/api/auth/login', { data: SUPER });
  expect(res.ok()).toBeTruthy();
}

let seq = 0;
export async function createFaculty(api: APIRequestContext): Promise<Faculty> {
  const res = await api.post('/api/admin/faculties', {
    data: { name: `Faculty ${Date.now()}-${++seq}` },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Faculty;
}

export async function uploadMedia(
  api: APIRequestContext,
  facultyId: number,
  name: string,
  buffer: Buffer,
): Promise<Media> {
  const res = await api.post(`/api/media?facultyId=${facultyId}`, {
    multipart: { file: { name, mimeType: 'application/octet-stream', buffer } },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as Media;
}

export async function waitReady(api: APIRequestContext, ids: number[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const list = (await (await api.get('/api/media')).json()) as Media[];
        return ids.every((id) => list.find((m) => m.id === id)?.status !== 'processing');
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

export async function createPlaylist(
  api: APIRequestContext,
  facultyId: number,
  items: { mediaId: number; durationSec?: number }[],
  defaultDurationSec = 1,
): Promise<PlaylistDetail> {
  const pl = (await (
    await api.post('/api/playlists', {
      data: { name: `Loop ${++seq}`, facultyId, defaultDurationSec, transition: 'fade' },
    })
  ).json()) as PlaylistDetail;
  const res = await api.put(`/api/playlists/${pl.id}/items`, { data: { items } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as PlaylistDetail;
}

/** Reads the pairing code off the player page, like a person would. */
export async function readPairingCode(page: Page): Promise<string> {
  const code = page.locator('.pairing-code');
  await expect(code).toHaveText(/^[A-Z0-9]{3} [A-Z0-9]{3}$/, { timeout: 15_000 });
  return (await code.innerText()).replace(/\s/g, '');
}

export async function pairViaApi(
  api: APIRequestContext,
  code: string,
  facultyId: number,
  extra: Record<string, unknown> = {},
): Promise<Display> {
  const res = await api.post('/api/admin/displays/pair', {
    data: { code, facultyId, name: `Screen ${++seq}`, ...extra },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { display: Display }).display;
}

/** URL of the image currently fully visible on the player. */
export function visibleSrc(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const layers = Array.from(document.querySelectorAll<HTMLElement>('.layer'));
    const front = layers.find((l) => l.style.opacity === '1');
    const media = Array.from(
      front?.querySelectorAll<HTMLImageElement | HTMLVideoElement>('.media') ?? [],
    ).find((m) => m.style.display !== 'none');
    return media ? media.getAttribute('src') : null;
  });
}
