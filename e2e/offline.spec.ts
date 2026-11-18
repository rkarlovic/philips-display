/**
 * Server goes down → the player keeps looping what it already has and shows a small
 * offline dot; server comes back → the player reconnects by itself.
 * Uses its own server process (port 8091) so it can be killed and restarted.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, request as pwRequest, test } from '@playwright/test';
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

const PORT = 8091;
const BASE = `http://localhost:${PORT}`;
const dataDir = path.join(os.tmpdir(), `slidecast-e2e-offline-${process.pid}`);

function startServer(): ChildProcess {
  return spawn(process.execPath, ['apps/server/dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      SESSION_SECRET: 'e2e-session-secret-0123456789',
      SUPERADMIN_EMAIL: SUPER.email,
      SUPERADMIN_PASSWORD: SUPER.password,
    },
    stdio: 'ignore',
  });
}

async function waitHealthy(): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${BASE}/api/health`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

let server: ChildProcess | undefined;
test.afterAll(() => {
  server?.kill();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // locked on Windows until the process is gone; teardown retries next run
  }
});

test('keeps looping while the server is down, then reconnects', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  server = startServer();
  await waitHealthy();
  const api = await pwRequest.newContext({ baseURL: BASE });
  await loginSuper(api);
  const fac = await createFaculty(api);
  const media = [];
  for (const c of ['#e53935', '#43a047', '#1e88e5']) {
    media.push(await uploadMedia(api, fac.id, `${c}.png`, await png(400, 300, c)));
  }
  await waitReady(
    api,
    media.map((m) => m.id),
  );
  const pl = await createPlaylist(
    api,
    fac.id,
    media.map((m) => ({ mediaId: m.id })),
  );

  await page.goto(`${BASE}/player`);
  const display = await pairViaApi(api, await readPairingCode(page), fac.id);
  await api.patch(`/api/displays/${display.id}`, { data: { defaultPlaylistId: pl.id } });
  // Let it go round the loop once so every image is in the browser cache.
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        const src = await visibleSrc(page);
        if (src) seen.add(src);
        return seen.size;
      },
      { timeout: 15_000, intervals: [200] },
    )
    .toBe(3);
  await api.dispose();

  // Server dies.
  server.kill();
  await expect(page.locator('body')).toHaveClass(/offline/, { timeout: 15_000 });
  const during = new Set<string>();
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    const src = await visibleSrc(page);
    if (src) during.add(src);
    await page.waitForTimeout(200);
  }
  expect(during.size).toBe(3); // still looping through everything, from memory/cache

  // Server comes back: reconnect within the backoff window, no page reload.
  server = startServer();
  await waitHealthy();
  await expect(page.locator('body')).not.toHaveClass(/offline/, { timeout: 45_000 });
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
});
