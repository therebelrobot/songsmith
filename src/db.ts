import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.SONGSMITH_DB ?? join(process.cwd(), 'data', 'songsmith.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL: concurrent reads while a write is in flight. Matters because autosave
// fires on every debounce tick while the UI is also polling.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// schema.sql is CREATE TABLE IF NOT EXISTS throughout, so re-running is a no-op.
// When phase 2 needs a real migration, add src/migrations/002-*.sql and a
// user_version check here.
const schemaPath = join(here, 'schema.sql');
db.exec(readFileSync(schemaPath, 'utf8'));

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
