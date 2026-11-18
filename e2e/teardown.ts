import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Best-effort cleanup of e2e data dirs. The server may still hold the current one open
 * (Windows locks it), so leftovers from earlier runs are removed on the next run.
 */
export default function teardown(): void {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith('slidecast-e2e-')) continue;
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      // still in use: next run
    }
  }
}
