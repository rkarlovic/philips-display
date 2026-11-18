import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Email } from '@slidecast/shared';

/** Repo root: works from both src/ (dev) and dist/ (build), which sit at the same depth. */
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  sessionSecret: string;
  superAdminEmail: string;
  superAdminPassword: string;
  timezone: string;
  maxUploadMb: number;
  pdfDpi: number;
  sofficePath: string | undefined;
  /** Built admin UI (apps/admin/dist); served at /admin when it exists. */
  adminDistDir: string;
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  SESSION_SECRET: z.string().min(16, 'must be at least 16 characters'),
  SUPERADMIN_EMAIL: Email,
  SUPERADMIN_PASSWORD: z.string().min(8, 'must be at least 8 characters'),
  TZ: z.string().default('Europe/Zagreb'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  PDF_DPI: z.coerce.number().int().positive().default(150),
  SOFFICE_PATH: z.string().optional(),
});

/** Loads `.env` from the repo root (if present) without overriding real env vars. */
export function loadDotEnv(): void {
  const file = path.join(repoRoot, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `Invalid configuration. Copy .env.example to .env and fill it in.\n${lines.join('\n')}`,
    );
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    dataDir: path.resolve(repoRoot, e.DATA_DIR),
    sessionSecret: e.SESSION_SECRET,
    superAdminEmail: e.SUPERADMIN_EMAIL,
    superAdminPassword: e.SUPERADMIN_PASSWORD,
    timezone: e.TZ,
    maxUploadMb: e.MAX_UPLOAD_MB,
    pdfDpi: e.PDF_DPI,
    sofficePath: e.SOFFICE_PATH || undefined,
    adminDistDir: path.join(repoRoot, 'apps', 'admin', 'dist'),
  };
}
