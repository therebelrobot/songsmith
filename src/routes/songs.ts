import type { FastifyInstance } from 'fastify';
import { db, touchSong, midpoint } from '../db';
import { schemeOf } from '../prosody/rhyme';
import {
  IdParam,
  SongCreate,
  SongPatch,
  SectionCreate,
  RevisionCreate,
  type SongRow,
  type SectionRow,
  type LineRow,
} from '../types';

function loadTree(songId: number) {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as unknown as SongRow | undefined;
  if (!song) return null;
  const sections = db
    .prepare('SELECT * FROM sections WHERE song_id = ? ORDER BY position')
    .all(songId) as unknown as SectionRow[];
  const lineStmt = db.prepare('SELECT * FROM lines WHERE section_id = ? ORDER BY position');
  return {
    ...song,
    sections: sections.map((s) => {
      const rows = lineStmt.all(s.id) as unknown as LineRow[];
      const scheme = schemeOf(rows.map((r) => r.text));
      return {
        ...s,
        lines: rows.map((r, i) => ({
          id: r.id,
          position: r.position,
          text: r.text,
          syllables: JSON.parse(r.syllables_json),
          alternates: JSON.parse(r.alternates_json),
          syllable_count: r.syllable_count,
          rhyme_key: r.rhyme_key,
          rhyme_label: scheme.labels[i] ?? null,
        })),
      };
    }),
  };
}

export default async function songRoutes(app: FastifyInstance) {
  app.get('/api/songs', async () => {
    return db
      .prepare('SELECT id, title, song_key, tempo_bpm, updated_at FROM songs ORDER BY updated_at DESC')
      .all();
  });

  app.post('/api/songs', async (req, reply) => {
    const b = SongCreate.parse(req.body ?? {});
    const r = db
      .prepare(
        `INSERT INTO songs (title, song_key, tempo_bpm, meter_num, meter_den, notes, voice_leading)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.title, b.song_key ?? null, b.tempo_bpm ?? null, b.meter_num, b.meter_den, b.notes, b.voice_leading ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    // A song with no sections is unusable in the UI, so seed one.
    db.prepare('INSERT INTO sections (song_id, name, position) VALUES (?, ?, ?)').run(
      id,
      'Verse 1',
      1000,
    );
    reply.code(201);
    return loadTree(id);
  });

  app.get('/api/songs/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const tree = loadTree(id);
    if (!tree) return reply.code(404).send({ error: 'song not found' });
    return tree;
  });

  app.patch('/api/songs/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = SongPatch.parse(req.body ?? {});
    const fields = Object.entries(b).filter(([, v]) => v !== undefined);
    if (fields.length > 0) {
      const set = fields.map(([k]) => `${k} = ?`).join(', ');
      // SQLite has no boolean bind type — node:sqlite rejects a raw JS boolean.
      const values = fields.map(([k, v]) => (k === 'voice_leading' ? (v ? 1 : 0) : (v as string | number | null)));
      const info = db
        .prepare(`UPDATE songs SET ${set}, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, id);
      if (info.changes === 0) return reply.code(404).send({ error: 'song not found' });
    }
    return loadTree(id);
  });

  app.delete('/api/songs/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const info = db.prepare('DELETE FROM songs WHERE id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'song not found' });
    return reply.code(204).send();
  });

  app.post('/api/songs/:id/sections', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = SectionCreate.parse(req.body ?? {});
    const exists = db.prepare('SELECT 1 FROM songs WHERE id = ?').get(id);
    if (!exists) return reply.code(404).send({ error: 'song not found' });

    let before: number | null = null;
    let after: number | null = null;
    if (b.after_id) {
      const row = db.prepare('SELECT position FROM sections WHERE id = ? AND song_id = ?').get(
        b.after_id,
        id,
      ) as { position: number } | undefined;
      if (!row) return reply.code(400).send({ error: 'after_id is not a section of this song' });
      before = row.position;
      const nxt = db
        .prepare('SELECT position FROM sections WHERE song_id = ? AND position > ? ORDER BY position LIMIT 1')
        .get(id, before) as { position: number } | undefined;
      after = nxt?.position ?? null;
    } else {
      const last = db
        .prepare('SELECT position FROM sections WHERE song_id = ? ORDER BY position DESC LIMIT 1')
        .get(id) as { position: number } | undefined;
      before = last?.position ?? null;
    }
    const r = db
      .prepare('INSERT INTO sections (song_id, name, position, bar_count) VALUES (?, ?, ?, ?)')
      .run(id, b.name, midpoint(before, after), b.bar_count ?? null);
    touchSong(id);
    reply.code(201);
    return db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(r.lastInsertRowid));
  });

  app.get('/api/songs/:id/revisions', async (req) => {
    const { id } = IdParam.parse(req.params);
    return db
      .prepare('SELECT id, label, created_at FROM revisions WHERE song_id = ? ORDER BY created_at DESC')
      .all(id);
  });

  app.post('/api/songs/:id/revisions', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = RevisionCreate.parse(req.body ?? {});
    const tree = loadTree(id);
    if (!tree) return reply.code(404).send({ error: 'song not found' });
    const r = db
      .prepare('INSERT INTO revisions (song_id, label, snapshot_json) VALUES (?, ?, ?)')
      .run(id, b.label, JSON.stringify(tree));
    reply.code(201);
    return { id: Number(r.lastInsertRowid), label: b.label };
  });

  app.post('/api/revisions/:id/restore', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const rev = db.prepare('SELECT * FROM revisions WHERE id = ?').get(id) as
      | { song_id: number; snapshot_json: string }
      | undefined;
    if (!rev) return reply.code(404).send({ error: 'revision not found' });
    const snap = JSON.parse(rev.snapshot_json) as ReturnType<typeof loadTree>;
    if (!snap) return reply.code(422).send({ error: 'revision snapshot is empty' });

    // Snapshot the current state before overwriting it, so restore is itself undoable.
    const current = loadTree(rev.song_id);
    if (current) {
      db.prepare('INSERT INTO revisions (song_id, label, snapshot_json) VALUES (?, ?, ?)').run(
        rev.song_id,
        'auto: before restore',
        JSON.stringify(current),
      );
    }

    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM sections WHERE song_id = ?').run(rev.song_id);
      const insSection = db.prepare(
        'INSERT INTO sections (song_id, name, position, bar_count) VALUES (?, ?, ?, ?)',
      );
      const insLine = db.prepare(
        `INSERT INTO lines (section_id, position, text, syllables_json, alternates_json, rhyme_key, syllable_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of snap.sections) {
        const sid = Number(
          insSection.run(rev.song_id, s.name, s.position, s.bar_count ?? null).lastInsertRowid,
        );
        for (const l of s.lines) {
          insLine.run(
            sid,
            l.position,
            l.text,
            JSON.stringify(l.syllables),
            JSON.stringify(l.alternates),
            l.rhyme_key,
            l.syllable_count,
          );
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    touchSong(rev.song_id);
    return loadTree(rev.song_id);
  });
}
