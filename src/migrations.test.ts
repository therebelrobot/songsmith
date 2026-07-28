import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Exercises src/db.ts's migration runner against a real file on disk — the
 * logic under test (isFreshDatabase, PRAGMA user_version) only means
 * anything against actual sqlite state, not something to fake through mocks.
 * Runs db.ts in a subprocess so its module-level side effects (which fire on
 * import) apply to a fresh SONGSMITH_DB every time, instead of the one file
 * already opened by this process's own db.ts import elsewhere in the suite.
 */
function runDbModule(dbPath: string): void {
  execFileSync('npx', ['tsx', '-e', "import('./src/db')"], {
    cwd: process.cwd(),
    env: { ...process.env, SONGSMITH_DB: dbPath },
    stdio: 'pipe',
  });
}

test('migration runner: a database that predates voice_leading gets the column added and user_version set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'songsmith-migration-'));
  const dbPath = join(dir, 'pre-existing.db');
  try {
    const seed = new DatabaseSync(dbPath);
    seed.exec(`
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT 'Untitled',
        song_key TEXT,
        tempo_bpm REAL,
        meter_num INTEGER NOT NULL DEFAULT 4,
        meter_den INTEGER NOT NULL DEFAULT 4,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seed.exec(`INSERT INTO songs (title) VALUES ('Old Song')`);
    seed.close();

    runDbModule(dbPath);

    const check = new DatabaseSync(dbPath);
    const version = check.prepare('PRAGMA user_version').get() as { user_version: number };
    const columns = (check.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);
    const row = check.prepare('SELECT voice_leading FROM songs WHERE title = ?').get('Old Song') as {
      voice_leading: number;
    };
    check.close();

    assert.equal(version.user_version, 3);
    assert.ok(columns.includes('voice_leading'));
    assert.equal(row.voice_leading, 1); // ALTER TABLE's DEFAULT 1 backfills the existing row
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration runner: a brand-new database gets the column from schema.sql and skips the migration file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'songsmith-migration-'));
  const dbPath = join(dir, 'fresh.db');
  try {
    runDbModule(dbPath);

    const check = new DatabaseSync(dbPath);
    const version = check.prepare('PRAGMA user_version').get() as { user_version: number };
    const columns = (check.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);
    check.close();

    assert.equal(version.user_version, 3);
    assert.ok(columns.includes('voice_leading'));
    assert.ok(columns.includes('chord_display'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration runner: a database that predates chord_display gets the column added, defaulted to names, and user_version set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'songsmith-migration-'));
  const dbPath = join(dir, 'pre-chord-display.db');
  try {
    const seed = new DatabaseSync(dbPath);
    seed.exec(`
      CREATE TABLE songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT 'Untitled',
        song_key TEXT,
        tempo_bpm REAL,
        meter_num INTEGER NOT NULL DEFAULT 4,
        meter_den INTEGER NOT NULL DEFAULT 4,
        notes TEXT NOT NULL DEFAULT '',
        voice_leading INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seed.exec(`PRAGMA user_version = 2`);
    seed.exec(`INSERT INTO songs (title) VALUES ('Pre-chord-display Song')`);
    seed.close();

    runDbModule(dbPath);

    const check = new DatabaseSync(dbPath);
    const version = check.prepare('PRAGMA user_version').get() as { user_version: number };
    const columns = (check.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);
    const row = check.prepare('SELECT chord_display FROM songs WHERE title = ?').get('Pre-chord-display Song') as {
      chord_display: string;
    };
    check.close();

    assert.equal(version.user_version, 3);
    assert.ok(columns.includes('chord_display'));
    assert.equal(row.chord_display, 'names'); // ALTER TABLE's DEFAULT 'names' backfills the existing row
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
