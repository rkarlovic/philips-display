/**
 * pnpm restore <backup-folder> --yes
 * The server must be stopped. The current data folder is moved aside, not deleted.
 */
import path from 'node:path';
import { restoreBackup, verifyBackup } from '../backup/index.js';
import { cliArgs, dataDirFromEnv } from './common.js';
import { repoRoot } from '../config.js';

async function serverIsRunning(): Promise<boolean> {
  const port = process.env['PORT'] ?? '8080';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const args = cliArgs(process.argv.slice(2), [], ['yes']);
  const source = args._[0];
  if (!source) {
    console.error('Usage: pnpm restore <backup-folder> --yes');
    process.exit(1);
  }
  const backupDir = path.resolve(repoRoot, source);
  const dataDir = dataDirFromEnv();
  const manifest = verifyBackup(backupDir);
  console.log(`Backup from ${manifest.createdAt}: ${JSON.stringify(manifest.counts)}`);

  if (await serverIsRunning()) {
    console.error('The SlideCast server is running. Stop it first, then run restore again.');
    process.exit(1);
  }
  if (!args.yes) {
    console.log(`This replaces ${dataDir} with the backup (the current data is kept aside).`);
    console.log('Run again with --yes to continue.');
    return;
  }
  const res = restoreBackup({ backupDir, dataDir });
  console.log(`Restored into ${dataDir}.`);
  if (res.previous) console.log(`Previous data kept in ${res.previous}`);
  console.log('Start the server; it applies any newer migrations automatically.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
