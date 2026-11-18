import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The display's built-in browser is an old Chromium: emit ES2019 and old-friendly CSS.
 * The player only imports *types* from @slidecast/shared, so no zod ends up in the bundle.
 */
export default defineConfig({
  base: '/player/',
  resolve: {
    alias: {
      '@slidecast/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
  build: {
    target: 'es2019',
    cssTarget: 'chrome61',
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
  },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8080', ws: true },
      '/media': 'http://localhost:8080',
    },
  },
});
