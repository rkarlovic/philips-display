/** Schedule editor in the admin UI drives what the real player shows. */
import { expect, test } from '@playwright/test';
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

test('an all-day schedule overrides the default playlist, and removing it switches back', async ({
  browser,
  request,
}) => {
  await loginSuper(request);
  const fac = await createFaculty(request);
  const red = await uploadMedia(request, fac.id, 'red.png', await png(320, 180, '#c62828'));
  const blue = await uploadMedia(request, fac.id, 'blue.png', await png(320, 180, '#1565c0'));
  await waitReady(request, [red.id, blue.id]);
  const plDefault = await createPlaylist(request, fac.id, [{ mediaId: red.id }], 5);
  const plSched = await createPlaylist(request, fac.id, [{ mediaId: blue.id }], 5);

  const screen = await (await browser.newContext()).newPage();
  await screen.goto('/player');
  const display = await pairViaApi(request, await readPairingCode(screen), fac.id, {
    name: 'Sched screen',
  });
  await request.patch(`/api/displays/${display.id}`, { data: { defaultPlaylistId: plDefault.id } });
  const redUrl = (await (await request.get(`/api/playlists/${plDefault.id}/preview`)).json())
    .items[0].url;
  const blueUrl = (await (await request.get(`/api/playlists/${plSched.id}/preview`)).json())
    .items[0].url;
  await expect.poll(() => visibleSrc(screen), { timeout: 15_000 }).toBe(redUrl);

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
  await admin.getByRole('link', { name: 'Displays' }).click();

  const card = admin.locator('.display-card', { hasText: 'Sched screen' });
  await expect(card).toContainText(`Default playlist: ${plDefault.name}`);
  await card.getByRole('button', { name: /Schedule \(0\)/ }).click();

  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('button', { name: '+ Add entry' }).click();
  await dialog.getByLabel('Playlist').selectOption(String(plSched.id));
  await dialog.getByRole('button', { name: 'Every day' }).click();
  await dialog.getByLabel('From', { exact: true }).fill('00:00');
  await dialog.getByLabel('To', { exact: true }).fill('00:00');
  await expect(dialog).toContainText('the whole day');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toContainText('Every day');
  await expect(dialog).toContainText('active now');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Live: card and player switch to the scheduled playlist.
  await expect(card).toContainText(`By schedule: ${plSched.name}`);
  await expect(card.getByRole('button', { name: /Schedule \(1\)/ })).toBeVisible();
  await expect.poll(() => visibleSrc(screen), { timeout: 15_000 }).toBe(blueUrl);

  // Remove the entry: back to the default playlist.
  await card.getByRole('button', { name: /Schedule \(1\)/ }).click();
  admin.once('dialog', (d) => void d.accept());
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toContainText('No entries');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(card).toContainText(`Default playlist: ${plDefault.name}`);
  await expect.poll(() => visibleSrc(screen), { timeout: 15_000 }).toBe(redUrl);
});
