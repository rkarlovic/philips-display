import path from 'node:path';
import { loadDotEnv, repoRoot } from '../config.js';

/** DATA_DIR from env / .env (the CLIs don't need the rest of the config). */
export function dataDirFromEnv(): string {
  loadDotEnv();
  return path.resolve(repoRoot, process.env['DATA_DIR'] ?? './data');
}

/** Minimal `--name value` / `--flag` parser. */
export function cliArgs(
  argv: string[],
  valued: string[],
  flags: string[] = [],
): Record<string, string | undefined> & { _: string[]; [flag: string]: unknown } {
  const out: Record<string, unknown> & { _: string[] } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = a.replace(/^--/, '');
    if (a.startsWith('--') && valued.includes(name)) out[name] = argv[++i];
    else if (a.startsWith('--') && flags.includes(name)) out[name] = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else out._.push(a);
  }
  return out as Record<string, string | undefined> & { _: string[] };
}

export function humanBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
