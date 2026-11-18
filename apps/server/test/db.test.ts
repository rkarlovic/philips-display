import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../src/db/index.js';

describe('migrations', () => {
  it('apply once and are idempotent on a file database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slidecast-'));
    const file = path.join(dir, 'db.sqlite');
    const db = openDb(file);
    expect(runMigrations(db)).toEqual([]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(['faculties', 'users', 'sessions', 'audit_log', 'schema_migrations']),
    );
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('enforces that faculty users have a faculty', () => {
    const db = openDb(':memory:');
    expect(() =>
      db
        .prepare(
          "INSERT INTO users (email, role, faculty_id) VALUES ('x@y.z', 'faculty_user', NULL)",
        )
        .run(),
    ).toThrow(/CHECK/);
    db.close();
  });
});
