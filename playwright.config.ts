import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (`pnpm build` first; `pnpm test:e2e` does it).
 * The server runs on port 8090 with a throwaway data directory.
 *
 * Note: Playwright's bundled Chromium has no H.264. Set PW_CHANNEL=chrome or msedge to
 * play real MP4s (the soak test does when available); without it, videos are skipped as errors.
 */
const PORT = 8090;
export const DATA_DIR = path.join(os.tmpdir(), `slidecast-e2e-${process.pid}`);
export const SUPER = { email: 'it@e2e.test', password: 'e2e-super-password' };

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalTeardown: './e2e/teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    channel: process.env['PW_CHANNEL'] || undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'e2e', testIgnore: /soak\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'soak',
      testMatch: /soak\.spec\.ts/,
      timeout: 0,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] },
      },
    },
  ],
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      SESSION_SECRET: 'e2e-session-secret-0123456789',
      SUPERADMIN_EMAIL: SUPER.email,
      SUPERADMIN_PASSWORD: SUPER.password,
      TZ: 'Europe/Zagreb',
    },
  },
});
