/**
 * pnpm backup [--out <dir>] [--keep <n>]
 * Safe while the server runs. Default output: <repo>/backups. Schedule it with the
 * OS (Task Scheduler / cron / launchd), see docs/deployment.md.
 */
import path from 'node:path';
import { createBackup, pruneBackups } from '../backup/index.js';
import { cliArgs, dataDirFromEnv, humanBytes } from './common.js';
import { repoRoot } from '../config.js';

async function main() {
  const args = cliArgs(process.argv.slice(2), ['out', 'keep']);
  const outDir = path.resolve(repoRoot, args.out ?? 'backups');
  const dataDir = dataDirFromEnv();
  const res = await createBackup({ dataDir, outDir });
  const c = res.manifest.counts;
  console.log(`Backup written to ${res.dir}`);
  console.log(
    `  ${c['faculties'] ?? 0} faculties, ${c['users'] ?? 0} users, ${c['media'] ?? 0} media, ` +
      `${c['playlists'] ?? 0} playlists, ${c['displays'] ?? 0} displays; ` +
      `${res.manifest.mediaFiles} files (${humanBytes(res.manifest.mediaBytes)})`,
  );
  if (res.missing.length > 0) {
    console.warn(
      `  Warning: ${res.missing.length} media files were deleted while copying; run the backup again.`,
    );
    process.exitCode = 2;
  }
  if (args.keep) {
    const removed = pruneBackups(outDir, Number(args.keep));
    if (removed.length)
      console.log(`  Removed ${removed.length} older backups (keeping ${args.keep}).`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
