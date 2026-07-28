import type { FastifyInstance } from 'fastify';
import { db, touchSong, midpoint, songIdOfSection, songIdOfLine } from '../db';
import { analyzeLine } from '../prosody/syllables';
import {
  IdParam,
  SectionPatch,
  LineCreate,
  LinePatch,
  PromoteBody,
  type SectionRow,
  type LineRow,
} from '../types';

/**
 * Resolve a new `position` from after_id/before_id within one sibling set.
 * Returns null when the anchors are not siblings of `table`.
 */
function positionBetween(
  table: 'sections' | 'lines',
  parentCol: 'song_id' | 'section_id',
  parentId: number,
  afterId: number | null | undefined,
  beforeId: number | null | undefined,
): number | null {
  const get = (id: number) =>
    db.prepare(`SELECT position FROM ${table} WHERE id = ? AND ${parentCol} = ?`).get(id, parentId) as
    | { position: number }
    | undefined;
  let before: number | null = null;
  let after: number | null = null;
  if (afterId) {
    const row = get(afterId);
    if (!row) return null;
    before = row.position;
  }
  if (beforeId) {
    const row = get(beforeId);
    if (!row) return null;
    after = row.position;
  }
  if (afterId && !beforeId) {
    const nxt = db
      .prepare(`SELECT position FROM ${table} WHERE ${parentCol} = ? AND position > ? ORDER BY position LIMIT 1`)
      .get(parentId, before as number) as { position: number } | undefined;
    after = nxt?.position ?? null;
  }
  if (beforeId && !afterId) {
    const prv = db
      .prepare(`SELECT position FROM ${table} WHERE ${parentCol} = ? AND position < ? ORDER BY position DESC LIMIT 1`)
      .get(parentId, after as number) as { position: number } | undefined;
    before = prv?.position ?? null;
  }
  return midpoint(before, after);
}

/** Recompute the cached prosody columns for a line. */
function writeProsody(lineId: number, text: string): void {
  const a = analyzeLine(text);
  db.prepare('UPDATE lines SET syllables_json = ?, syllable_count = ?, rhyme_key = ? WHERE id = ?').run(
    JSON.stringify(a.words),
    a.count,
    a.rhymeKey,
    lineId,
  );
}

export default async function lineRoutes(app: FastifyInstance) {
  app.patch('/api/sections/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = SectionPatch.parse(req.body ?? {});
    const songId = songIdOfSection(id);
    if (songId === null) return reply.code(404).send({ error: 'section not found' });

    if (b.name !== undefined) {
      db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(b.name, id);
    }
    if (b.bar_count !== undefined) {
      db.prepare('UPDATE sections SET bar_count = ? WHERE id = ?').run(b.bar_count ?? null, id);
    }
    if (b.after_id || b.before_id) {
      const pos = positionBetween('sections', 'song_id', songId, b.after_id, b.before_id);
      if (pos === null) return reply.code(400).send({ error: 'anchor is not in this song' });
      db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(pos, id);
    }
    touchSong(songId);
    return db.prepare('SELECT * FROM sections WHERE id = ?').get(id) as unknown as SectionRow;
  });

  app.delete('/api/sections/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const songId = songIdOfSection(id);
    if (songId === null) return reply.code(404).send({ error: 'section not found' });
    db.prepare('DELETE FROM sections WHERE id = ?').run(id);
    touchSong(songId);
    return reply.code(204).send();
  });

  app.post('/api/sections/:id/lines', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = LineCreate.parse(req.body ?? {});
    const songId = songIdOfSection(id);
    if (songId === null) return reply.code(404).send({ error: 'section not found' });

    let pos: number;
    if (b.after_id) {
      const resolved = positionBetween('lines', 'section_id', id, b.after_id, null);
      if (resolved === null) return reply.code(400).send({ error: 'after_id is not in this section' });
      pos = resolved;
    } else {
      const last = db
        .prepare('SELECT position FROM lines WHERE section_id = ? ORDER BY position DESC LIMIT 1')
        .get(id) as { position: number } | undefined;
      pos = midpoint(last?.position ?? null, null);
    }
    const r = db
      .prepare('INSERT INTO lines (section_id, position, text) VALUES (?, ?, ?)')
      .run(id, pos, b.text);
    const lineId = Number(r.lastInsertRowid);
    writeProsody(lineId, b.text);
    touchSong(songId);
    reply.code(201);
    return db.prepare('SELECT * FROM lines WHERE id = ?').get(lineId) as unknown as LineRow;
  });

  app.patch('/api/lines/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = LinePatch.parse(req.body ?? {});
    const songId = songIdOfLine(id);
    if (songId === null) return reply.code(404).send({ error: 'line not found' });
    const row = db.prepare('SELECT * FROM lines WHERE id = ?').get(id) as unknown as LineRow;

    if (b.text !== undefined) {
      db.prepare(`UPDATE lines SET text = ?, updated_at = datetime('now') WHERE id = ?`).run(b.text, id);
      writeProsody(id, b.text);
    }
    if (b.alternates !== undefined) {
      db.prepare('UPDATE lines SET alternates_json = ? WHERE id = ?').run(
        JSON.stringify(b.alternates),
        id,
      );
    }
    if (b.after_id || b.before_id) {
      const pos = positionBetween('lines', 'section_id', row.section_id, b.after_id, b.before_id);
      if (pos === null) return reply.code(400).send({ error: 'anchor is not in this section' });
      db.prepare('UPDATE lines SET position = ? WHERE id = ?').run(pos, id);
    }
    touchSong(songId);
    return db.prepare('SELECT * FROM lines WHERE id = ?').get(id) as unknown as LineRow;
  });

  /** Swap live text with an alternate. Nothing is ever deleted — that is the point. */
  app.post('/api/lines/:id/promote', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = PromoteBody.parse(req.body ?? {});
    const songId = songIdOfLine(id);
    if (songId === null) return reply.code(404).send({ error: 'line not found' });
    const row = db.prepare('SELECT * FROM lines WHERE id = ?').get(id) as unknown as LineRow;
    const alts = JSON.parse(row.alternates_json) as string[];
    const picked = alts[b.index];
    if (picked === undefined) return reply.code(400).send({ error: 'index out of range' });
    alts[b.index] = row.text;
    db.prepare(`UPDATE lines SET text = ?, alternates_json = ?, updated_at = datetime('now') WHERE id = ?`).run(
      picked,
      JSON.stringify(alts),
      id,
    );
    writeProsody(id, picked);
    touchSong(songId);
    return db.prepare('SELECT * FROM lines WHERE id = ?').get(id) as unknown as LineRow;
  });

  app.delete('/api/lines/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const songId = songIdOfLine(id);
    if (songId === null) return reply.code(404).send({ error: 'line not found' });
    db.prepare('DELETE FROM lines WHERE id = ?').run(id);
    touchSong(songId);
    return reply.code(204).send();
  });
}
