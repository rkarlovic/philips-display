import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@slidecast/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Many tests spawn ffmpeg/ffprobe/LibreOffice. On CI runners (macOS especially, where
    // the first run of a downloaded binary is checked by the OS) that can exceed 5 s.
    testTimeout: 30_000,
  },
});
