-- Phase 5: per-song toggle between voice-led and blocked root-position chords.
-- Only runs against a database that predates this column — see src/db.ts,
-- which sets user_version straight to the latest migration for a brand-new
-- database (schema.sql already creates this column there).
ALTER TABLE songs ADD COLUMN voice_leading INTEGER NOT NULL DEFAULT 1;
