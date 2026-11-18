/** The player in a real browser: pairing, loop, commands, rotation, revoke. */
import { expect, test } from '@playwright/test';
import {
  createFaculty,
  createPlaylist,
  loginSuper,
  pairViaApi,
  png,
  readPairingCode,
  uploadMedia,
  visibleSrc,
  waitReady,
} from './helpers.js';

test('pair, loop, control, rotate, revoke', async ({ page, request }) => {
  await loginSuper(request);
  const fac = await createFaculty(request);
  const media = [
    await uploadMedia(request, fac.id, 'red.png', await png(640, 360, '#d32f2f')),
    await uploadMedia(request, fac.id, 'green.png', await png(640, 360, '#388e3c')),
    await uploadMedia(request, fac.id, 'blue.png', await png(640, 360, '#1976d2')),
  ];
  await waitReady(
    request,
    media.map((m) => m.id),
  );
  const playlist = await createPlaylist(
    request,
    fac.id,
    media.map((m) => ({ mediaId: m.id })),
  );

  // 1. A fresh display shows a pairing code and the server address.
  await page.goto('/player');
  const code = await readPairingCode(page);
  await expect(page.locator('.pairing-server')).toContainText('localhost:8090');

  // 2. IT pairs it; the display picks up its token by itself and shows the idle clock.
  const display = await pairViaApi(request, code, fac.id);
  await expect(page.locator('.idle-time')).toHaveText(/^\d{2}:\d{2}$/, { timeout: 15_000 });
  await expect(page.locator('.idle-name')).toHaveText(fac.name);
  expect(await page.evaluate(() => localStorage.getItem('slidecast.token'))).toBeTruthy();

  // 3. Setting the default playlist is pushed live; the loop runs and wraps around.
  await request.patch(`/api/displays/${display.id}`, { data: { defaultPlaylistId: playlist.id } });
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const src = await visibleSrc(page);
        if (src && seen[seen.length - 1] !== src) seen.push(src);
        return seen.length;
      },
      { timeout: 15_000, intervals: [200] },
    )
    .toBeGreaterThanOrEqual(4);
  expect(seen[3]).toBe(seen[0]); // back to the first item: it loops
  expect(new Set(seen).size).toBe(3);
  // A fixed set of media elements (img + video per layer) is reused, never recreated.
  expect(await page.locator('.media').count()).toBe(4);

  // 4. The admin sees it online, with what's playing.
  await expect
    .poll(async () => (await (await request.get(`/api/displays/${display.id}`)).json()).online)
    .toBe(true);

  // 5. Pause holds the current item; resume continues.
  await request.post(`/api/displays/${display.id}/command`, { data: { command: 'pause' } });
  await expect
    .poll(
      async () => (await (await request.get(`/api/displays/${display.id}`)).json()).state?.paused,
    )
    .toBe(true);
  const held = await visibleSrc(page);
  await page.waitForTimeout(2500);
  expect(await visibleSrc(page)).toBe(held);
  await request.post(`/api/displays/${display.id}/command`, { data: { command: 'resume' } });
  await expect.poll(() => visibleSrc(page), { timeout: 5000 }).not.toBe(held);

  // 6. Rotation is applied by the player (portrait display).
  await request.patch(`/api/displays/${display.id}`, { data: { rotation: 90 } });
  await expect
    .poll(() =>
      page.evaluate(() => (document.querySelector('.stage') as HTMLElement).style.transform),
    )
    .toContain('rotate(90deg)');
  const box = await page.evaluate(() => {
    const s = document.querySelector('.stage') as HTMLElement;
    return { w: s.style.width, h: s.style.height };
  });
  expect(box).toEqual({ w: '720px', h: '1280px' });

  // 7. Revoked: back to the pairing screen, token forgotten.
  await request.delete(`/api/admin/displays/${display.id}`);
  await readPairingCode(page);
  expect(await page.evaluate(() => localStorage.getItem('slidecast.token'))).toBeNull();
});

test('fallback setup URL with ?token= works and is stored', async ({ page, request }) => {
  await loginSuper(request);
  const fac = await createFaculty(request);
  await page.goto('/player');
  const code = await readPairingCode(page);
  const display = await pairViaApi(request, code, fac.id);
  const res = await request.post(`/api/admin/displays/${display.id}/token`);
  const { setupPath } = (await res.json()) as { setupPath: string };

  const fresh = await page.context().newPage();
  await fresh.goto(setupPath.replace('/player/', '/player'));
  await expect(fresh.locator('.idle-time')).toBeVisible({ timeout: 15_000 });
  expect(fresh.url()).not.toContain('token='); // removed from the address bar once stored
});
