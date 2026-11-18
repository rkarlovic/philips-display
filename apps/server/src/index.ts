import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadDotEnv } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './app.js';
import { createEmailAuthProvider, ensureSuperAdmin } from './auth/email-provider.js';
import { purgeExpiredSessions } from './auth/sessions.js';

async function main() {
  loadDotEnv();
  const config = loadConfig();

  // First run: create data/ (db, media, tmp).
  for (const dir of [
    config.dataDir,
    path.join(config.dataDir, 'media'),
    path.join(config.dataDir, 'tmp'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = openDb(path.join(config.dataDir, 'db.sqlite'));
  await ensureSuperAdmin(db, config.superAdminEmail, config.superAdminPassword);
  purgeExpiredSessions(db, new Date());

  const app = await buildApp(
    { config, db, auth: createEmailAuthProvider(db), now: () => new Date() },
    { logger: { level: 'info' } },
  );

  await app.listen({ port: config.port, host: config.host });

  const urls = ['localhost', ...lanAddresses()].map((h) => `  http://${h}:${config.port}/admin/`);
  console.log(`\nSlideCast is running. Admin UI:\n${urls.join('\n')}\n`);
  if (!fs.existsSync(config.adminDistDir)) {
    console.log('  (admin UI not built yet: run `pnpm build`, or use `pnpm dev` on port 5173)\n');
  }

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
