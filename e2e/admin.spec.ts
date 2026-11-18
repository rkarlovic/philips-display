/** Admin UI flow: pair a display through the form and control it live. */
import { expect, test } from '@playwright/test';
import { SUPER } from '../playwright.config.js';
import {
  createFaculty,
  createPlaylist,
  loginSuper,
  png,
  readPairingCode,
  uploadMedia,
  waitReady,
} from './helpers.js';

test('pair through the admin UI and see live status', async ({ browser, request }) => {
  await loginSuper(request);
  const fac = await createFaculty(request);
  const m = await uploadMedia(request, fac.id, 'slide.png', await png(320, 180, '#6a1b9a'));
  await waitReady(request, [m.id]);
  const playlist = await createPlaylist(request, fac.id, [{ mediaId: m.id }], 3);

  const screen = await (await browser.newContext()).newPage();
  await screen.goto('/player');
  const code = await readPairingCode(screen);

  const admin = await (await browser.newContext({ locale: 'en-US' })).newPage();
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
  // The waiting display's code is offered as a chip; the form is filled by hand anyway.
  await expect(admin.getByRole('button', { name: new RegExp(code) })).toBeVisible();
  await admin.getByLabel('Code on screen').fill(code.toLowerCase());
  await admin.getByLabel('Faculty').selectOption(String(fac.id));
  await admin.getByLabel('Display name').fill('Entrance');
  await admin.getByLabel('Location').fill('Ground floor');
  await admin.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(admin.getByText('Display “Entrance” is paired')).toBeVisible();
  await expect(admin.locator('.setup-url')).toContainText('/player/?token=');

  const card = admin.locator('.display-card', { hasText: 'Entrance' });
  await expect(card.getByText('Connected')).toBeVisible({ timeout: 15_000 });

  await card.getByLabel('Default playlist').selectOption(String(playlist.id));
  await expect(card).toContainText('Showing: slide.png', { timeout: 15_000 });

  await card.getByRole('button', { name: /Pause/ }).click();
  await expect(card.getByText('Paused')).toBeVisible();
  await card.getByRole('button', { name: /Resume/ }).click();
  await expect(card.getByText('Paused')).toBeHidden();

  // Closing the display's browser shows it as not connected.
  await screen.context().close();
  await expect(card.getByText(/Not connected/)).toBeVisible({ timeout: 15_000 });

  // Everything above is in the audit log, filterable.
  await admin.getByRole('link', { name: 'Audit log' }).click();
  await admin.getByLabel('Type').selectOption('display');
  const rows = admin.locator('table.audit tbody tr');
  await expect(rows.filter({ hasText: 'Paired · display' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Command · display' })).toHaveCount(2); // pause + resume
  await expect(rows.filter({ hasText: 'Login' })).toHaveCount(0); // filtered out
  await rows.filter({ hasText: 'Paired' }).getByText('Show').click();
  await expect(rows.filter({ hasText: 'Paired' }).locator('pre')).toContainText(
    '"name": "Entrance"',
  );
});
