import type { FastifyInstance } from 'fastify';
import { db, touchSong } from '../db';
import { resolveLineTiming } from '../timing/resolve';
import { placeChords, type GridSyllableInput } from '../timing/leadsheet';
import { songIdOfLine } from './lines';
import { IdParam, LineTimingBody, type LineTimingRow, type SongRow, type ChordRow } from '../types';

interface GridRow {
  line_id: number;
  start_bar: number;
  start_beat: number;
  syllable_offsets_json: string;
  syllable_count: number;
}

export interface Grid {
  meter_num: number;
  meter_den: number;
  tempo_bpm: number | null;
  lines: {
    line_id: number;
    start_bar: number;
    start_beat: number;
    syllables: { index: number; bar: number; beat: number; pinned: boolean }[];
  }[];
  chords: ReturnType<typeof placeChords>;
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
  const chords = placeChords(chordRows, allSyllables, beatsPerBar);

  return {
    meter_num: song.meter_num,
    meter_den: song.meter_den,
    tempo_bpm: song.tempo_bpm,
    lines,
    chords,
  };
}

export default async function timingRoutes(app: FastifyInstance) {
  app.put('/api/lines/:id/timing', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = LineTimingBody.parse(req.body ?? {});
    const songId = songIdOfLine(id);
    if (songId === null) return reply.code(404).send({ error: 'line not found' });

    db.prepare(
      `INSERT INTO line_timing (line_id, start_bar, start_beat, syllable_offsets_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(line_id) DO UPDATE SET
         start_bar = excluded.start_bar,
         start_beat = excluded.start_beat,
         syllable_offsets_json = excluded.syllable_offsets_json`,
    ).run(id, b.start_bar, b.start_beat, JSON.stringify(b.syllable_offsets));
    touchSong(songId);

    const row = db.prepare('SELECT * FROM line_timing WHERE line_id = ?').get(id) as unknown as LineTimingRow;
    return {
      line_id: row.line_id,
      start_bar: row.start_bar,
      start_beat: row.start_beat,
      syllable_offsets: JSON.parse(row.syllable_offsets_json),
    };
  });

  app.delete('/api/lines/:id/timing', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const songId = songIdOfLine(id);
    if (songId === null) return reply.code(404).send({ error: 'line not found' });
    db.prepare('DELETE FROM line_timing WHERE line_id = ?').run(id);
    touchSong(songId);
    return reply.code(204).send();
  });

  /**
   * The resolved timeline: every line that has timing, with each syllable's
   * absolute bar/beat. Interpolation happens in timing/resolve.ts (pure, no
   * db) — the client renders straight from this response rather than
   * reimplementing that maths, so the two can't drift.
   */
  app.get('/api/songs/:id/grid', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const grid = buildGrid(id);
    if (!grid) return reply.code(404).send({ error: 'song not found' });
    return grid;
  });
}
