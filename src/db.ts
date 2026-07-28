import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Resolved from process.cwd(), not import.meta.url: esbuild bundles this
// module into dist/index.js, so an import.meta.url-derived path resolves
// relative to dist/, not the project root — the same class of bug the
// dictionary path had (see prosody/cmudict.ts). schema.sql and migrations/
// are plain data, so the Docker image copies them to ./src alongside data/
// rather than duplicating them into dist/, and this path is then identical
// in dev (tsx, run from the repo root) and in the built/Docker runtime.
const SCHEMA_DIR = join(process.cwd(), 'src');

const DB_PATH = process.env.SONGSMITH_DB ?? join(process.cwd(), 'data', 'songsmith.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL: concurrent reads while a write is in flight. Matters because autosave
// fires on every debounce tick while the UI is also polling.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

function tableExists(name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

// A database file with no `songs` table yet is brand new — schema.sql below
// creates it with every column this version needs, so there is nothing for
// the migration loop to apply. Checked before schema.sql runs, since that
// call is what would otherwise make an old and a new database indistinguishable.
const isFreshDatabase = !tableExists('songs');

// schema.sql is CREATE TABLE IF NOT EXISTS throughout, so re-running it against
// an existing database is a no-op; a fresh one gets every table at its current shape.
db.exec(readFileSync(join(SCHEMA_DIR, 'schema.sql'), 'utf8'));

// Ordered, numbered ALTERs for columns/tables added after a database already
// exists. Each file must be safe to run exactly once against a database that
// predates it — schema.sql already has the fresh-database case covered.
const MIGRATIONS: { version: number; file: string }[] = [
  { version: 2, file: '002-voice-leading.sql' },
];

if (isFreshDatabase) {
  const latest = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 1);
  db.exec(`PRAGMA user_version = ${latest}`);
} else {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= version) continue;
    db.exec(readFileSync(join(SCHEMA_DIR, 'migrations', m.file), 'utf8'));
    db.exec(`PRAGMA user_version = ${m.version}`);
    version = m.version;
  }
}

export function touchSong(songId: number): void {
  db.prepare(`UPDATE songs SET updated_at = datetime('now') WHERE id = ?`).run(songId);
}

/** position value that sorts between `before` and `after`. Either may be null. */
export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return (after as number) - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}

export function songIdOfSection(sectionId: number): number | null {
  const r = db.prepare('SELECT song_id FROM sections WHERE id = ?').get(sectionId) as
    | { song_id: number }
    | undefined;
  return r?.song_id ?? null;
}

export function songIdOfLine(lineId: number): number | null {
  const r = db
    .prepare('SELECT s.song_id AS song_id FROM lines l JOIN sections s ON s.id = l.section_id WHERE l.id = ?')
    .get(lineId) as { song_id: number } | undefined;
  return r?.song_id ?? null;
}
