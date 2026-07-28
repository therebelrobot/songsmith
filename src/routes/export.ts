import type { FastifyInstance } from 'fastify';
import { db } from '../db';
import { buildGrid } from './timing';
import { serializeChordPro, parseChordPro, planChordProImport, type ChordProInput } from '../export/chordpro';
import { buildMidi } from '../export/midi';
import { IdParam, ChordProImportBody, type SongRow, type SectionRow } from '../types';

interface ExportLineRow {
  id: number;
  text: string;
  syllables_json: string;
}

/** Combines the lyric tree with the resolved grid — the shared input both export.chordpro and export.mid build from. */
function buildChordProInput(songId: number): ChordProInput | null {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as unknown as SongRow | undefined;
  if (!song) return null;
  const grid = buildGrid(songId);
  if (!grid) return null; // song existed a moment ago; guards a concurrent delete

  const gridLineById = new Map(grid.lines.map((l) => [l.line_id, l]));
  const sections = db
    .prepare('SELECT * FROM sections WHERE song_id = ? ORDER BY position')
    .all(songId) as unknown as SectionRow[];
  const lineStmt = db.prepare('SELECT id, text, syllables_json FROM lines WHERE section_id = ? ORDER BY position');

  return {
    title: song.title,
    song_key: song.song_key,
    tempo_bpm: song.tempo_bpm,
    meter_num: song.meter_num,
    meter_den: song.meter_den,
    sections: sections.map((s) => {
      const rows = lineStmt.all(s.id) as unknown as ExportLineRow[];
      return {
        name: s.name,
        bar_count: s.bar_count,
        lines: rows.map((r) => {
          const g = gridLineById.get(r.id);
          return {
            id: r.id,
            text: r.text,
            words: JSON.parse(r.syllables_json),
            timed: !!g,
            start_bar: g?.start_bar ?? null,
          };
        }),
      };
    }),
    chords: grid.chords.map((c) => ({ bar: c.bar, beat: c.beat, symbol: c.symbol, line_id: c.line_id, syllable_index: c.syllable_index })),
  };
}

/** Writes a planChordProImport() plan as a brand-new song, in one transaction. Never touches an existing song. */
function applyImportPlan(plan: ReturnType<typeof planChordProImport>): number {
  db.exec('BEGIN');
  try {
    const songR = db
      .prepare('INSERT INTO songs (title, song_key, tempo_bpm, meter_num, meter_den, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(plan.title, plan.song_key, plan.tempo_bpm, plan.meter_num, plan.meter_den, '');
    const songId = Number(songR.lastInsertRowid);

    const insSection = db.prepare('INSERT INTO sections (song_id, name, position, bar_count) VALUES (?, ?, ?, ?)');
    const insLine = db.prepare(
      `INSERT INTO lines (section_id, position, text, syllables_json, alternates_json, rhyme_key, syllable_count)
       VALUES (?, ?, ?, ?, '[]', ?, ?)`,
    );
    const insTiming = db.prepare(
      'INSERT INTO line_timing (line_id, start_bar, start_beat, syllable_offsets_json) VALUES (?, ?, ?, ?)',
    );
    const insChord = db.prepare('INSERT INTO chords (song_id, bar, beat, symbol, duration_beats) VALUES (?, ?, ?, ?, ?)');

    let sectionPos = 1000;
    for (const s of plan.sections) {
      const secR = insSection.run(songId, s.name, sectionPos, s.bar_count);
      sectionPos += 1000;
      const sectionId = Number(secR.lastInsertRowid);

      let linePos = 1000;
      for (const l of s.lines) {
        const lineR = insLine.run(sectionId, linePos, l.text, JSON.stringify(l.words), l.rhyme_key, l.syllable_count);
        linePos += 1000;
        const lineId = Number(lineR.lastInsertRowid);
        if (l.timing) {
          insTiming.run(lineId, l.timing.start_bar, l.timing.start_beat, JSON.stringify(l.timing.syllable_offsets));
        }
      }
    }
    for (const c of plan.chords) insChord.run(songId, c.bar, c.beat, c.symbol, c.duration_beats);

    db.exec('COMMIT');
    return songId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** ASCII-safe, quote-free filename stem for a Content-Disposition header. */
function filenameStem(title: string): string {
  const safe = title.trim().replace(/[^A-Za-z0-9 _-]/g, '').trim();
  return safe.length > 0 ? safe : 'song';
}

export default async function exportRoutes(app: FastifyInstance) {
  app.get('/api/songs/:id/export.chordpro', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const input = buildChordProInput(id);
    if (!input) return reply.code(404).send({ error: 'song not found' });
    const text = serializeChordPro(input);
    reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filenameStem(input.title)}.chordpro"`);
    return text;
  });

  app.post('/api/import/chordpro', async (req, reply) => {
    const b = ChordProImportBody.parse(req.body ?? {});
    const parsed = parseChordPro(b.text);
    const plan = planChordProImport(parsed);
    const songId = applyImportPlan(plan);
    reply.code(201);
    return { song_id: songId, warnings: plan.warnings };
  });

  app.get('/api/songs/:id/export.mid', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as SongRow | undefined;
    if (!song) return reply.code(404).send({ error: 'song not found' });
    const grid = buildGrid(id)!;

    const usedDefaultTempo = song.tempo_bpm == null;
    const bytes = buildMidi({
      tempo_bpm: song.tempo_bpm ?? 120,
      meter_num: song.meter_num,
      meter_den: song.meter_den,
      chords: grid.chords.map((c) => ({ bar: c.bar, beat: c.beat, duration_beats: c.duration_beats, notes: c.voicing })),
    });

    reply
      .header('content-type', 'audio/midi')
      .header('content-disposition', `attachment; filename="${filenameStem(song.title)}.mid"`);
    if (usedDefaultTempo) reply.header('x-songsmith-default-tempo', '120');
    return reply.send(Buffer.from(bytes));
  });
}
