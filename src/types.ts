import { z } from 'zod';

export const IdParam = z.object({ id: z.coerce.number().int().positive() });

export const SongCreate = z.object({
  title: z.string().min(1).max(200).default('Untitled'),
  song_key: z.string().max(16).nullish(),
  tempo_bpm: z.number().min(20).max(400).nullish(),
  meter_num: z.number().int().min(1).max(32).default(4),
  meter_den: z.number().int().refine((n) => [1, 2, 4, 8, 16].includes(n)).default(4),
  notes: z.string().max(20000).default(''),
});

export const SongPatch = z
  .object({
    title: z.string().min(1).max(200),
    song_key: z.string().max(16).nullish(),
    tempo_bpm: z.number().min(20).max(400).nullish(),
    meter_num: z.number().int().min(1).max(32),
    meter_den: z.number().int().refine((n) => [1, 2, 4, 8, 16].includes(n)),
    notes: z.string().max(20000),
  })
  .partial();

export const SectionCreate = z.object({
  name: z.string().min(1).max(80).default('Verse'),
  after_id: z.number().int().positive().nullish(),
  bar_count: z.number().int().min(0).max(2048).nullish(),
});

export const SectionPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  bar_count: z.number().int().min(0).max(2048).nullish(),
  after_id: z.number().int().positive().nullish(),
  before_id: z.number().int().positive().nullish(),
});

export const LineCreate = z.object({
  text: z.string().max(2000).default(''),
  after_id: z.number().int().positive().nullish(),
});

export const LinePatch = z.object({
  text: z.string().max(2000).optional(),
  alternates: z.array(z.string().max(2000)).max(50).optional(),
  after_id: z.number().int().positive().nullish(),
  before_id: z.number().int().positive().nullish(),
});

/** Swap the live text with alternates[index]; the old text becomes an alternate. */
export const PromoteBody = z.object({ index: z.number().int().min(0) });

export const AnalyzeBody = z.object({
  lines: z.array(z.string().max(2000)).min(1).max(500),
});

export const RevisionCreate = z.object({ label: z.string().max(120).default('') });

/** offset is sixteenth notes from the line's start; index is ordinal into analyzeLine().words.flatMap(syllables). */
export const SyllableAnchor = z.object({
  index: z.number().int().min(0),
  offset: z.number().int().min(0),
});

export const LineTimingBody = z.object({
  start_bar: z.number().int().min(1),
  start_beat: z.number().min(1).default(1),
  syllable_offsets: z.array(SyllableAnchor).max(500).default([]),
});

export interface SongRow {
  id: number;
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  meter_num: number;
  meter_den: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SectionRow {
  id: number;
  song_id: number;
  name: string;
  position: number;
  bar_count: number | null;
  created_at: string;
}

export interface LineRow {
  id: number;
  section_id: number;
  position: number;
  text: string;
  syllables_json: string;
  alternates_json: string;
  rhyme_key: string | null;
  syllable_count: number;
  updated_at: string;
}

export interface LineTimingRow {
  line_id: number;
  start_bar: number;
  start_beat: number;
  syllable_offsets_json: string;
}

/**
 * `replace` disambiguates a write onto an occupied (song_id, bar, beat) slot:
 * false (the default) returns a 409 with the occupant; true overwrites it
 * deliberately. See idx_chords_pos in schema.sql.
 */
export const ChordCreate = z.object({
  bar: z.number().int().min(1),
  beat: z.number().min(1).default(1),
  symbol: z.string().min(1).max(24),
  duration_beats: z.number().min(0.25).max(64).default(4),
  replace: z.boolean().default(false),
});

export const ChordPatch = z.object({
  bar: z.number().int().min(1).optional(),
  beat: z.number().min(1).optional(),
  symbol: z.string().min(1).max(24).optional(),
  duration_beats: z.number().min(0.25).max(64).optional(),
  replace: z.boolean().default(false),
});

/**
 * The client computes transposed symbols itself (with tonal, for correct
 * enharmonic spelling — see the phase 4 handoff on the server's hand-rolled
 * table getting "Am" up a semitone wrong as "A#m" instead of "Bbm") and this
 * just writes the already-computed result atomically. One transposition
 * implementation, not two.
 */
export const ChordSymbolWrite = z.object({
  id: z.number().int().positive(),
  symbol: z.string().min(1).max(24),
});

export const TransposeWriteBody = z.object({
  song_key: z.string().max(16).optional(),
  chords: z.array(ChordSymbolWrite).max(500).default([]),
});

export const ChordProImportBody = z.object({
  text: z.string().min(1).max(200_000),
});

export interface ChordRow {
  id: number;
  song_id: number;
  bar: number;
  beat: number;
  symbol: string;
  duration_beats: number;
}
