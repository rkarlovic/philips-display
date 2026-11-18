import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openDb, type Db } from '../src/db/index.js';
import { createBackup, pruneBackups, restoreBackup, verifyBackup } from '../src/backup/index.js';

let root: string;
let dataDir: string;
let outDir: string;
let db: Db;

const FILE_A = `${'a'.repeat(64)}.webp`;
const FILE_B = `${'b'.repeat(64)}.webp`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'slidecast-backup-'));
  dataDir = path.join(root, 'data');
  outDir = path.join(root, 'backups');
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  db = openDb(path.join(dataDir, 'db.sqlite')); // file DB in WAL mode, like production
  const fac = db.prepare("INSERT INTO faculties (name) VALUES ('Original')").run();
  const media = db
    .prepare(
      "INSERT INTO media (faculty_id, kind, original_name, size, status, thumb_file) VALUES (?, 'image', 'a.png', 3, 'ready', ?)",
    )
    .run(fac.lastInsertRowid, FILE_A);
  db.prepare(
    'INSERT INTO media_pages (media_id, page_no, file, thumb_file, width, height) VALUES (?, 1, ?, ?, 10, 10)',
  ).run(media.lastInsertRowid, FILE_B, FILE_A);
  fs.writeFileSync(path.join(dataDir, 'media', FILE_A), 'AAA');
  fs.writeFileSync(path.join(dataDir, 'media', FILE_B), 'BBBB');
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // already closed
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe('backup', () => {
  it('snapshots the live database (WAL, open connection) and the media files', async () => {
    // Uncheckpointed write still in the WAL: the snapshot must include it.
    db.prepare("INSERT INTO faculties (name) VALUES ('In WAL')").run();
    const res = await createBackup({ dataDir, outDir, now: new Date(2026, 2, 1, 10, 0, 0) });
    expect(path.basename(res.dir)).toBe('slidecast-backup-20260301-100000');
    expect(res.missing).toEqual([]);
    expect(res.manifest).toMatchObject({
      app: 'slidecast',
      mediaFiles: 2,
      mediaBytes: 7,
      counts: expect.objectContaining({ faculties: 2, media: 1 }),
    });
    expect(res.manifest.migrations).toContain('001_init.sql');
    const snap = new Database(path.join(res.dir, 'db.sqlite'), { readonly: true });
    expect(snap.prepare('SELECT name FROM faculties ORDER BY id').all()).toEqual([
      { name: 'Original' },
      { name: 'In WAL' },
    ]);
    snap.close();
    expect(verifyBackup(res.dir).createdAt).toBe(res.manifest.createdAt);
  });

  it('reports referenced files that are missing', async () => {
    fs.rmSync(path.join(dataDir, 'media', FILE_B));
    const res = await createBackup({ dataDir, outDir });
    expect(res.missing).toEqual([FILE_B]);
    expect(() => verifyBackup(res.dir)).toThrow(/missing/);
  });

  it('keeps only the newest N', async () => {
    for (let s = 0; s < 4; s++)
      await createBackup({ dataDir, outDir, now: new Date(2026, 2, 1, 10, 0, s) });
    const removed = pruneBackups(outDir, 2);
    expect(removed).toEqual([
      'slidecast-backup-20260301-100001',
      'slidecast-backup-20260301-100000',
    ]);
    expect(fs.readdirSync(outDir).sort()).toEqual([
      'slidecast-backup-20260301-100002',
      'slidecast-backup-20260301-100003',
    ]);
  });
});

describe('restore', () => {
  it('replaces data with the backup and keeps the old data aside', async () => {
    const { dir } = await createBackup({ dataDir, outDir });
    db.prepare("UPDATE faculties SET name = 'Changed after backup'").run();
    db.close();

    const res = restoreBackup({ backupDir: dir, dataDir, now: new Date(2026, 2, 2, 9, 0, 0) });
    expect(res.previous).toBe(`${dataDir}-before-restore-20260302-090000`);
    expect(fs.existsSync(path.join(res.previous!, 'db.sqlite'))).toBe(true);

    const restored = openDb(path.join(dataDir, 'db.sqlite'));
    expect(restored.prepare('SELECT name FROM faculties').all()).toEqual([{ name: 'Original' }]);
    restored.close();
    expect(fs.readFileSync(path.join(dataDir, 'media', FILE_B), 'utf8')).toBe('BBBB');
    expect(fs.existsSync(path.join(dataDir, 'tmp'))).toBe(true);
  });

  it('refuses something that is not a valid backup, and leaves data untouched', async () => {
    const fake = path.join(root, 'not-a-backup');
    fs.mkdirSync(fake);
    expect(() => restoreBackup({ backupDir: fake, dataDir })).toThrow(/not a SlideCast backup/);
    const { dir } = await createBackup({ dataDir, outDir });
    fs.writeFileSync(path.join(dir, 'db.sqlite'), 'garbage');
    expect(() => restoreBackup({ backupDir: dir, dataDir })).toThrow();
    expect(fs.existsSync(path.join(dataDir, 'db.sqlite'))).toBe(true);
  });
});
