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

export const SongPatch = SongCreate.partial();

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
