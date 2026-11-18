/**
 * Long-running player memory test (`pnpm test:soak`).
 * Plays a fast loop (1 s per image, plus a short video) for SOAK_MINUTES (default 5)
 * and checks that JS heap and DOM node counts stay flat.
 *
 * Use PW_CHANNEL=chrome or msedge so the MP4 really plays (bundled Chromium lacks H.264).
 * For release checks run it for hours: SOAK_MINUTES=240 pnpm test:soak
 */
import { expect, test } from '@playwright/test';
import {
  createFaculty,
  createPlaylist,
  loginSuper,
  makeVideo,
  pairViaApi,
  png,
  readPairingCode,
  uploadMedia,
  visibleSrc,
  waitReady,
} from './helpers.js';

const MINUTES = Number(process.env['SOAK_MINUTES'] ?? 5);
const SAMPLE_EVERY_MS = 15_000;

test('player memory stays flat', async ({ page, request }) => {
  await loginSuper(request);
  const fac = await createFaculty(request);
  const colors = ['#c62828', '#2e7d32', '#1565c0', '#f9a825', '#6a1b9a'];
  const media = [];
  for (const [i, c] of colors.entries()) {
    media.push(await uploadMedia(request, fac.id, `img${i}.png`, await png(1920, 1080, c)));
  }
  media.push(await uploadMedia(request, fac.id, 'clip.mp4', await makeVideo('libx264')));
  await waitReady(
    request,
    media.map((m) => m.id),
  );
  const playlist = await createPlaylist(
    request,
    fac.id,
    media.map((m) => ({ mediaId: m.id })),
    1,
  );

  await page.goto('/player');
  const display = await pairViaApi(request, await readPairingCode(page), fac.id);
  await request.patch(`/api/displays/${display.id}`, { data: { defaultPlaylistId: playlist.id } });
  await expect.poll(() => visibleSrc(page), { timeout: 15_000 }).not.toBeNull();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = (await cdp.send('Performance.getMetrics')) as {
      metrics: { name: string; value: number }[];
    };
    const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
    const media = await page.locator('.media').count();
    return {
      heap: get('JSHeapUsedSize'),
      nodes: get('Nodes'),
      listeners: get('JSEventListeners'),
      media,
    };
  };

  // Warm up one minute (caches, JIT), then measure.
  await page.waitForTimeout(60_000);
  const start = await sample();
  const samples = [start];
  const end = Date.now() + MINUTES * 60_000;
  while (Date.now() < end) {
    await page.waitForTimeout(SAMPLE_EVERY_MS);
    const s = await sample();
    samples.push(s);
    console.log(
      `heap ${(s.heap / 1e6).toFixed(2)} MB · nodes ${s.nodes} · listeners ${s.listeners} · media ${s.media}`,
    );
  }
  const last = samples[samples.length - 1]!;
  const state = (await (await request.get(`/api/displays/${display.id}`)).json()) as {
    state: { errors: string[] } | null;
  };
  console.log('reported errors:', state.state?.errors ?? []);

  // Flat means: no steady growth beyond noise.
  expect(last.heap).toBeLessThan(start.heap * 1.5 + 2e6);
  expect(last.nodes).toBeLessThan(start.nodes + 200);
  expect(last.listeners).toBeLessThan(start.listeners + 50);
  expect(new Set(samples.map((s) => s.media))).toEqual(new Set([4])); // elements are reused
});
