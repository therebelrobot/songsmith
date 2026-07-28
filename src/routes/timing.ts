import type { FastifyInstance } from 'fastify';
import { db, touchSong, songIdOfLine } from '../db';
import { buildGrid } from '../music/grid';
import { IdParam, LineTimingBody, type LineTimingRow } from '../types';

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
