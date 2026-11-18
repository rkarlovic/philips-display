/** IT creates a takeover in the admin UI; the real player switches; "End now" switches back. */
import { expect, test } from '@playwright/test';
import type { PlaylistDetail } from '@slidecast/shared';
import { SUPER } from '../playwright.config.js';
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

test('takeover announcement from the admin UI', async ({ browser, request }) => {
  await loginSuper(request);
  const fac = await createFaculty(request);
  const own = await uploadMedia(request, fac.id, 'own.png', await png(320, 180, '#2e7d32'));
  // University media + playlist (no facultyId → university).
  const uniRes = await request.post('/api/media', {
    multipart: {
      file: {
        name: 'uni.png',
        mimeType: 'application/octet-stream',
        buffer: await png(320, 180, '#f9a825'),
      },
    },
  });
  const uni = await uniRes.json();
  await waitReady(request, [own.id, uni.id]);
  const plOwn = await createPlaylist(request, fac.id, [{ mediaId: own.id }], 5);
  const plUni = (await (
    await request.post('/api/playlists', {
      data: { name: `Uni ${Date.now()}`, defaultDurationSec: 5 },
    })
  ).json()) as PlaylistDetail;
  await request.put(`/api/playlists/${plUni.id}/items`, { data: { items: [{ mediaId: uni.id }] } });

  const screen = await (await browser.newContext()).newPage();
  await screen.goto('/player');
  const display = await pairViaApi(request, await readPairingCode(screen), fac.id, {
    name: 'Lobby TV',
  });
  await request.patch(`/api/displays/${display.id}`, { data: { defaultPlaylistId: plOwn.id } });
  const ownUrl = (await (await request.get(`/api/playlists/${plOwn.id}/preview`)).json()).items[0]
    .url;
  const uniUrl = (await (await request.get(`/api/playlists/${plUni.id}/preview`)).json()).items[0]
    .url;
  await expect.poll(() => visibleSrc(screen), { timeout: 15_000 }).toBe(ownUrl);

  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/admin/');
  await admin.getByLabel(/E-pošta|Email/).fill(SUPER.email);
  await admin.getByRole('button', { name: /Prijavi se|Log in/ }).click();
  await admin.getByLabel(/Lozinka|Password/).fill(SUPER.password);
  await admin.getByRole('button', { name: /Prijavi se|Log in/ }).click();
  await admin
    .getByRole('combobox', { name: /Jezik|Language/ })
    .first()
    .selectOption('en');

  await admin.getByRole('link', { name: 'Announcements' }).click();
  await admin.getByRole('button', { name: '+ New announcement' }).click();
  await admin.getByLabel('Name').fill('Fire drill');
  await admin.getByLabel('University playlist').selectOption(String(plUni.id));
  await admin.getByRole('radio', { name: /Takeover/ }).check();
  await admin.getByRole('radio', { name: 'Selected displays' }).check();
  await admin.getByRole('checkbox', { name: /Lobby TV/ }).check();
  // Starts now (pre-filled with the current time); no end.
  await admin.getByRole('button', { name: 'Save' }).click();

  const row = admin.locator('tr', { hasText: 'Fire drill' });
  await expect(row).toContainText('Active');
  await expect(row).toContainText('1 displays');

  // The player switches to the university content at once.
  await expect.poll(() => visibleSrc(screen), { timeout: 15_000 }).toBe(uniUrl);

  // The display card shows it (what a faculty user sees too).
  await admin.getByRole('link', { name: 'Displays' }).click();
  const card = admin.locator('.display-card', { hasText: 'Lobby TV' });
  await expect(card).toContainText('University announcement: Fire drill');

  // End it: back to the faculty's own content.
  await admin.getByRole('link', { name: 'Announcements' }).click();
  admin.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'End now' }).click();
  await expect(row).toContainText('Ended');
  await expect.poll(() => visibleSrc(screen), { timeout: 15_000 }).toBe(ownUrl);
});
