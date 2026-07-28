-- songsmith schema, migration 1
-- Layers are independent: a `lines` row is valid with no timing and no chords.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL DEFAULT 'Untitled',
  song_key     TEXT,               -- e.g. 'Am'. NULL until you pick one.
  tempo_bpm    REAL,               -- NULL until phase 2.
  meter_num    INTEGER NOT NULL DEFAULT 4,
  meter_den    INTEGER NOT NULL DEFAULT 4,
  notes        TEXT    NOT NULL DEFAULT '',
  voice_leading INTEGER NOT NULL DEFAULT 1,  -- phase 5: blocked root-position chords when 0
  chord_display TEXT   NOT NULL DEFAULT 'names',  -- 'names' or 'numbers' — display only, never affects storage
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL DEFAULT 'Verse',
  position   REAL    NOT NULL,     -- REAL so reorder = midpoint insert, no renumbering
  bar_count  INTEGER,              -- NULL until phase 2
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sections_song ON sections(song_id, position);

CREATE TABLE IF NOT EXISTS lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  position        REAL    NOT NULL,
  text            TEXT    NOT NULL DEFAULT '',
  syllables_json  TEXT    NOT NULL DEFAULT '[]',  -- cached tokenization, see prosody/
  alternates_json TEXT    NOT NULL DEFAULT '[]',  -- demoted versions of this line
  rhyme_key       TEXT,                           -- phoneme tail, NULL if unknown word
  syllable_count  INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lines_section ON lines(section_id, position);
CREATE INDEX IF NOT EXISTS idx_lines_rhyme  ON lines(rhyme_key);

-- Phase 2 target. Created now so the FK exists and phase 2 adds no migration.
CREATE TABLE IF NOT EXISTS line_timing (
  line_id                INTEGER PRIMARY KEY REFERENCES lines(id) ON DELETE CASCADE,
  start_bar              INTEGER NOT NULL,
  start_beat             REAL    NOT NULL DEFAULT 1,
  syllable_offsets_json  TEXT    NOT NULL DEFAULT '[]'  -- sparse: anchored syllables only
);

-- Phase 3 target. Keyed to the bar grid, NOT to lines, so rewriting a lyric
-- leaves the progression untouched.
CREATE TABLE IF NOT EXISTS chords (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id        INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  bar            INTEGER NOT NULL,
  beat           REAL    NOT NULL DEFAULT 1,
  symbol         TEXT    NOT NULL,
  duration_beats REAL    NOT NULL DEFAULT 4
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chords_pos ON chords(song_id, bar, beat);

CREATE TABLE IF NOT EXISTS revisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id       INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  label         TEXT    NOT NULL DEFAULT '',
  snapshot_json TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revisions_song ON revisions(song_id, created_at DESC);
