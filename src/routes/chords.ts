import type { FastifyInstance } from 'fastify';
import { db, touchSong } from '../db';
import { IdParam, ChordCreate, ChordPatch, TransposeWriteBody, type ChordRow, type SongRow } from '../types';

export default async function chordRoutes(app: FastifyInstance) {
  app.post('/api/songs/:id/chords', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = ChordCreate.parse(req.body ?? {});
    const song = db.prepare('SELECT 1 FROM songs WHERE id = ?').get(id);
    if (!song) return reply.code(404).send({ error: 'song not found' });

    const occupant = db
      .prepare('SELECT * FROM chords WHERE song_id = ? AND bar = ? AND beat = ?')
      .get(id, b.bar, b.beat) as ChordRow | undefined;
    if (occupant && !b.replace) {
      return reply.code(409).send({ error: 'a chord already occupies this position', chord: occupant });
    }

    let chordId: number;
    if (occupant) {
      db.prepare('UPDATE chords SET symbol = ?, duration_beats = ? WHERE id = ?').run(
        b.symbol,
        b.duration_beats,
        occupant.id,
      );
      chordId = occupant.id;
    } else {
      const r = db
        .prepare('INSERT INTO chords (song_id, bar, beat, symbol, duration_beats) VALUES (?, ?, ?, ?, ?)')
        .run(id, b.bar, b.beat, b.symbol, b.duration_beats);
      chordId = Number(r.lastInsertRowid);
    }
    touchSong(id);
    reply.code(occupant ? 200 : 201);
    return db.prepare('SELECT * FROM chords WHERE id = ?').get(chordId) as unknown as ChordRow;
  });

  app.patch('/api/chords/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = ChordPatch.parse(req.body ?? {});
    const row = db.prepare('SELECT * FROM chords WHERE id = ?').get(id) as unknown as ChordRow | undefined;
    if (!row) return reply.code(404).send({ error: 'chord not found' });

    const bar = b.bar ?? row.bar;
    const beat = b.beat ?? row.beat;
    const symbol = b.symbol ?? row.symbol;
    const durationBeats = b.duration_beats ?? row.duration_beats;

    if (bar !== row.bar || beat !== row.beat) {
      const occupant = db
        .prepare('SELECT * FROM chords WHERE song_id = ? AND bar = ? AND beat = ? AND id != ?')
        .get(row.song_id, bar, beat, id) as ChordRow | undefined;
      if (occupant) {
        if (!b.replace) {
          return reply.code(409).send({ error: 'a chord already occupies this position', chord: occupant });
        }
        db.prepare('DELETE FROM chords WHERE id = ?').run(occupant.id);
      }
    }

    db.prepare('UPDATE chords SET bar = ?, beat = ?, symbol = ?, duration_beats = ? WHERE id = ?').run(
      bar,
      beat,
      symbol,
      durationBeats,
      id,
    );
    touchSong(row.song_id);
    return db.prepare('SELECT * FROM chords WHERE id = ?').get(id) as unknown as ChordRow;
  });

  app.delete('/api/chords/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const row = db.prepare('SELECT song_id FROM chords WHERE id = ?').get(id) as { song_id: number } | undefined;
    if (!row) return reply.code(404).send({ error: 'chord not found' });
    db.prepare('DELETE FROM chords WHERE id = ?').run(id);
    touchSong(row.song_id);
    return reply.code(204).send();
  });

  /**
   * Atomic write for a transposition the client already computed (with
   * tonal — see TransposeWriteBody). Every chord id must belong to this
   * song; the whole batch commits or none of it does.
   */
  app.post('/api/songs/:id/transpose', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = TransposeWriteBody.parse(req.body ?? {});
    const song = db.prepare('SELECT 1 FROM songs WHERE id = ?').get(id);
    if (!song) return reply.code(404).send({ error: 'song not found' });

    if (b.chords.length > 0) {
      const placeholders = b.chords.map(() => '?').join(',');
      const owned = db
        .prepare(`SELECT id FROM chords WHERE song_id = ? AND id IN (${placeholders})`)
        .all(id, ...b.chords.map((c) => c.id)) as { id: number }[];
      const ownedIds = new Set(owned.map((r) => r.id));
      const foreign = b.chords.find((c) => !ownedIds.has(c.id));
      if (foreign) return reply.code(400).send({ error: `chord ${foreign.id} does not belong to this song` });
    }

    db.exec('BEGIN');
    try {
      const update = db.prepare('UPDATE chords SET symbol = ? WHERE id = ?');
      for (const c of b.chords) update.run(c.symbol, c.id);
      if (b.song_key !== undefined) {
        db.prepare(`UPDATE songs SET song_key = ?, updated_at = datetime('now') WHERE id = ?`).run(b.song_key, id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return {
      song: db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as SongRow,
      chords: db.prepare('SELECT * FROM chords WHERE song_id = ? ORDER BY bar, beat').all(id) as unknown as ChordRow[],
    };
  });
}
