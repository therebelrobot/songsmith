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
    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as SongRow | undefined;
    if (!song) return reply.code(404).send({ error: 'song not found' });

    const beatsPerBar = song.meter_num;
    const rows = db
      .prepare(
        `SELECT lt.line_id, lt.start_bar, lt.start_beat, lt.syllable_offsets_json, l.syllable_count
         FROM line_timing lt
         JOIN lines l ON l.id = lt.line_id
         JOIN sections s ON s.id = l.section_id
         WHERE s.song_id = ?`,
      )
      .all(id) as unknown as GridRow[];

    const lines = rows.map((r) => {
      const anchors = JSON.parse(r.syllable_offsets_json) as { index: number; offset: number }[];
      const pinned = new Set(anchors.map((a) => a.index));
      return {
        line_id: r.line_id,
        start_bar: r.start_bar,
        start_beat: r.start_beat,
        // `pinned` marks which syllables are explicit anchors vs interpolated —
        // the client needs this to render pin state, but it's presentation,
        // not maths, so it's added here rather than in resolveLineTiming.
        syllables: resolveLineTiming(
          { startBar: r.start_bar, startBeat: r.start_beat, syllableOffsets: anchors },
          r.syllable_count,
          beatsPerBar,
        ).map((s) => ({ ...s, pinned: pinned.has(s.index) })),
      };
    });

    const chordRows = db
      .prepare('SELECT * FROM chords WHERE song_id = ? ORDER BY bar, beat')
      .all(id) as unknown as ChordRow[];
    const allSyllables: GridSyllableInput[] = lines.flatMap((l) =>
      l.syllables.map((s) => ({ line_id: l.line_id, index: s.index, bar: s.bar, beat: s.beat })),
    );
    // Placement is pure and shared with src/timing/leadsheet.ts's tests, so the
    // client's inline rendering can never drift from what this endpoint says.
    const chords = placeChords(chordRows, allSyllables, beatsPerBar);

    return {
      meter_num: song.meter_num,
      meter_den: song.meter_den,
      tempo_bpm: song.tempo_bpm,
      lines,
      chords,
    };
  });
}
