import { db } from '../db';
import { resolveLineTiming } from './resolve';
import { placeChords, type GridSyllableInput, type PlacedChord } from './leadsheet';
import { resolveVoicings } from './voiceLeading';
import type { SongRow, ChordRow } from '../types';

interface GridRow {
  line_id: number;
  start_bar: number;
  start_beat: number;
  syllable_offsets_json: string;
  syllable_count: number;
}

export interface VoicedChord extends PlacedChord {
  /** MIDI note numbers, per src/music/voiceLeading.ts — the same array src/export/midi.ts uses for this chord. */
  voicing: number[];
}

export interface Grid {
  meter_num: number;
  meter_den: number;
  tempo_bpm: number | null;
  voice_leading: boolean;
  lines: {
    line_id: number;
    start_bar: number;
    start_beat: number;
    syllables: { index: number; bar: number; beat: number; pinned: boolean }[];
  }[];
  chords: VoicedChord[];
}

/**
 * The resolved timeline for a song: every timed line's syllables placed on
 * the bar grid, plus every chord placed relative to them. Shared by the
 * GET .../grid route and the ChordPro/MIDI export routes so there's exactly
 * one place that combines resolveLineTiming and placeChords.
 */
export function buildGrid(songId: number): Grid | null {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as unknown as SongRow | undefined;
  if (!song) return null;

  const beatsPerBar = song.meter_num;
  const rows = db
    .prepare(
      `SELECT lt.line_id, lt.start_bar, lt.start_beat, lt.syllable_offsets_json, l.syllable_count
       FROM line_timing lt
       JOIN lines l ON l.id = lt.line_id
       JOIN sections s ON s.id = l.section_id
       WHERE s.song_id = ?`,
    )
    .all(songId) as unknown as GridRow[];

  const lines = rows.map((r) => {
    const anchors = JSON.parse(r.syllable_offsets_json) as { index: number; offset: number }[];
    const pinned = new Set(anchors.map((a) => a.index));
    return {
      line_id: r.line_id,
      start_bar: r.start_bar,
      start_beat: r.start_beat,
      syllables: resolveLineTiming(
        { startBar: r.start_bar, startBeat: r.start_beat, syllableOffsets: anchors },
        r.syllable_count,
        beatsPerBar,
      ).map((s) => ({ ...s, pinned: pinned.has(s.index) })),
    };
  });

  const chordRows = db
    .prepare('SELECT * FROM chords WHERE song_id = ? ORDER BY bar, beat')
    .all(songId) as unknown as ChordRow[];
  const allSyllables: GridSyllableInput[] = lines.flatMap((l) =>
    l.syllables.map((s) => ({ line_id: l.line_id, index: s.index, bar: s.bar, beat: s.beat })),
  );
  const placed = placeChords(chordRows, allSyllables, beatsPerBar);
  const voiceLeading = !!song.voice_leading;
  // Voicing is a function of the whole chord *sequence* (voice leading looks at
  // the previous chord), so it's computed once here in bar/beat order, not
  // per-chord — the same call src/export/midi.ts makes, so the two can't drift.
  const voicings = resolveVoicings(placed, voiceLeading);
  const chords: VoicedChord[] = placed.map((c, i) => ({ ...c, voicing: voicings[i] as number[] }));

  return {
    meter_num: song.meter_num,
    meter_den: song.meter_den,
    tempo_bpm: song.tempo_bpm,
    voice_leading: voiceLeading,
    lines,
    chords,
  };
}
