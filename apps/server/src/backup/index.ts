/**
 * Backup and restore of data/ (database + media). No extra tools needed.
 *
 * Backup is safe while the server runs:
 *  - the database is copied with SQLite's online backup API (a consistent snapshot);
 *  - media files are content-addressed and never change, so copying them is safe;
 *  - afterwards every file the snapshot refers to is checked to be in the backup.
 * A backup is a plain folder: db.sqlite, media/, manifest.json.
 *
 * Restore needs the server stopped. The current data folder is kept aside
 * (data-before-restore-<time>), never deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const BACKUP_PREFIX = 'slidecast-backup-';

export interface BackupManifest {
  app: 'slidecast';
  format: 1;
  createdAt: string;
  migrations: string[];
  counts: Record<string, number>;
  mediaFiles: number;
  mediaBytes: number;
}

export interface BackupResult {
  dir: string;
  manifest: BackupManifest;
  /** Referenced files that could not be copied (deleted meanwhile); normally empty. */
  missing: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Every media file name the database refers to. */
function referencedFiles(db: Database.Database): Set<string> {
  const names = new Set<string>();
  const add = (rows: unknown[]) => {
    for (const r of rows as Record<string, string | null>[]) {
      for (const v of Object.values(r)) if (v) names.add(v);
    }
  };
  add(db.prepare('SELECT thumb_file, video_file FROM media').all());
  add(db.prepare('SELECT file, thumb_file FROM media_pages').all());
  return names;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function describe(db: Database.Database): Pick<BackupManifest, 'migrations' | 'counts'> {
  const migrations = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: string;
    }[]
  ).map((r) => r.version);
  const tables = [
    'faculties',
    'users',
    'media',
    'playlists',
    'displays',
    'schedules',
    'announcements',
  ];
  const existing = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name),
  );
  const counts: Record<string, number> = {};
  for (const t of tables) if (existing.has(t)) counts[t] = count(db, t);
  return { migrations, counts };
}

export async function createBackup(opts: {
  dataDir: string;
  outDir: string;
  now?: Date;
}): Promise<BackupResult> {
  const dbFile = path.join(opts.dataDir, 'db.sqlite');
  if (!fs.existsSync(dbFile)) throw new Error(`No database at ${dbFile}`);
  const now = opts.now ?? new Date();
  const dir = path.join(opts.outDir, `${BACKUP_PREFIX}${stamp(now)}`);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  const work = `${dir}.partial`;
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, 'media'), { recursive: true });

  // 1. Consistent database snapshot.
  const live = new Database(dbFile, { fileMustExist: true });
  try {
    await live.backup(path.join(work, 'db.sqlite'));
  } finally {
    live.close();
  }

  // 2. Media files (immutable; tolerate files deleted while copying).
  const mediaDir = path.join(opts.dataDir, 'media');
  let mediaFiles = 0;
  let mediaBytes = 0;
  if (fs.existsSync(mediaDir)) {
    for (const name of fs.readdirSync(mediaDir)) {
      if (name.endsWith('.part')) continue;
      try {
        fs.copyFileSync(path.join(mediaDir, name), path.join(work, 'media', name));
        mediaFiles++;
        mediaBytes += fs.statSync(path.join(work, 'media', name)).size;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
  }

  // 3. Check that everything the snapshot needs is there; describe it.
  const snap = new Database(path.join(work, 'db.sqlite'), { readonly: true });
  let missing: string[];
  let info: ReturnType<typeof describe>;
  try {
    missing = [...referencedFiles(snap)].filter((f) => !fs.existsSync(path.join(work, 'media', f)));
    info = describe(snap);
  } finally {
    snap.close();
  }
  const manifest: BackupManifest = {
    app: 'slidecast',
    format: 1,
    createdAt: now.toISOString(),
    ...info,
    mediaFiles,
    mediaBytes,
  };
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.renameSync(work, dir);
  return { dir, manifest, missing };
}

/** Deletes all but the newest `keep` backups in `outDir`. Returns the deleted folders. */
export function pruneBackups(outDir: string, keep: number): string[] {
  if (!fs.existsSync(outDir)) return [];
  const all = fs
    .readdirSync(outDir)
    .filter((n) => n.startsWith(BACKUP_PREFIX) && !n.endsWith('.partial'))
    .sort()
    .reverse();
  const old = all.slice(Math.max(0, keep));
  for (const n of old) fs.rmSync(path.join(outDir, n), { recursive: true, force: true });
  return old;
}

/** Checks a backup folder; returns its manifest or throws with a clear reason. */
export function verifyBackup(backupDir: string): BackupManifest {
  const manifestFile = path.join(backupDir, 'manifest.json');
  const dbFile = path.join(backupDir, 'db.sqlite');
  if (!fs.existsSync(manifestFile) || !fs.existsSync(dbFile)) {
    throw new Error(`${backupDir} is not a SlideCast backup (manifest.json/db.sqlite missing)`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as BackupManifest;
  if (manifest.app !== 'slidecast') throw new Error('manifest.json is not from SlideCast');
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const ok = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
      .integrity_check;
    if (ok !== 'ok') throw new Error(`database integrity check failed: ${ok}`);
    const missing = [...referencedFiles(db)].filter(
      (f) => !fs.existsSync(path.join(backupDir, 'media', f)),
    );
    if (missing.length > 0) {
      throw new Error(`${missing.length} media files are missing from the backup`);
    }
  } finally {
    db.close();
  }
  return manifest;
}

/**
 * Replaces dataDir with the backup. The current dataDir is moved aside first.
 * Returns where the previous data went (null if there was none).
 */
export function restoreBackup(opts: { backupDir: string; dataDir: string; now?: Date }): {
  previous: string | null;
  manifest: BackupManifest;
} {
  const manifest = verifyBackup(opts.backupDir);
  const now = opts.now ?? new Date();
  let previous: string | null = null;
  if (fs.existsSync(opts.dataDir)) {
    previous = `${opts.dataDir}-before-restore-${stamp(now)}`;
    fs.renameSync(opts.dataDir, previous);
  }
  fs.mkdirSync(path.join(opts.dataDir, 'tmp'), { recursive: true });
  fs.copyFileSync(path.join(opts.backupDir, 'db.sqlite'), path.join(opts.dataDir, 'db.sqlite'));
  fs.cpSync(path.join(opts.backupDir, 'media'), path.join(opts.dataDir, 'media'), {
    recursive: true,
  });
  return { previous, manifest };
}
