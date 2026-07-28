-- Per-song toggle between letter-name and Nashville Number chord display.
-- TEXT rather than boolean: a third mode (roman numerals) is a plausible
-- later request and shouldn't need another migration. Display only — never
-- changes what's stored in the chords table. Only runs against a database
-- that predates this column — see src/db.ts, which sets user_version
-- straight to the latest migration for a brand-new database (schema.sql
-- already creates this column there).
ALTER TABLE songs ADD COLUMN chord_display TEXT NOT NULL DEFAULT 'names';
