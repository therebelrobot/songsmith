import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { analyzeLine, analyzeWord, rhymeKeyOf } from '../prosody/syllables';
import { schemeOf, rhymeScore } from '../prosody/rhyme';
import { phonemes, entryCount, entries } from '../prosody/cmudict';

const SuggestQuery = z.object({
  word: z.string().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** 1.0 = perfect rhymes only. 0.5 opens it up to slant rhymes. */
  min_score: z.coerce.number().min(0).max(1).default(1),
});

const AnalyzeBody = z.object({ lines: z.array(z.string().max(2000)).min(1).max(500) });

export default async function prosodyRoutes(app: FastifyInstance) {
  app.post('/api/prosody/analyze', async (req) => {
    const b = AnalyzeBody.parse(req.body ?? {});
    const scheme = schemeOf(b.lines);
    return {
      lines: b.lines.map((text, i) => ({
        ...analyzeLine(text),
        rhyme_label: scheme.labels[i] ?? null,
      })),
    };
  });

  app.get('/api/prosody/word/:word', async (req, reply) => {
    const word = z.string().min(1).max(60).parse((req.params as { word: string }).word);
    const a = analyzeWord(word);
    if (a.count === 0) return reply.code(404).send({ error: 'nothing to analyze' });
    return { ...a, phonemes: phonemes(word) };
  });

  /**
   * Rhyme suggestions. Perfect rhymes are a single Map lookup on the rhyme key.
   * Slant rhymes scan the distinct keys (~19k) rather than the words (~126k).
   * Measured on x86: 708 ms to build the index on first call, then 7-8 ms for a
   * perfect-rhyme lookup and 59-94 ms for a slant scan. Estimate 3-5x on a Pi 4
   * (unverified) — perfect rhymes stay inside a 200 ms keystroke debounce, slant
   * rhymes are better wired to an explicit button.
   */
  app.get('/api/prosody/rhymes', async (req, reply) => {
    const q = SuggestQuery.parse(req.query);
    const source = phonemes(q.word);
    if (!source) return reply.code(404).send({ error: 'word not in dictionary' });
    const key = rhymeKeyOf(source);
    if (!key) return reply.code(422).send({ error: 'word has no vowel nucleus' });

    const target = q.word.toUpperCase();
    const byKey = rhymeIndex();
    const hits: { word: string; score: number; syllables: number }[] = [];

    const push = (words: string[], score: number) => {
      for (const w of words) {
        if (w === target) continue;
        hits.push({ word: w.toLowerCase(), score, syllables: syllablesOf(w) });
      }
    };

    if (q.min_score >= 1) {
      push(byKey.get(key) ?? [], 1);
    } else {
      for (const [k, words] of byKey) {
        const score = rhymeScore(key, k);
        if (score >= q.min_score) push(words, score);
      }
    }
    hits.sort((a, b) => b.score - a.score || a.syllables - b.syllables || a.word.localeCompare(b.word));
    return { word: q.word, rhyme_key: key, matches: hits.slice(0, q.limit) };
  });

  app.get('/api/prosody/status', async () => ({
    dictionary_entries: entryCount(),
    source: 'CMU Pronouncing Dictionary 0.7b (BSD-2-Clause)',
  }));
}

/** Lazily built: rhyme key -> words sharing it, plus a syllable-count cache. */
let index: Map<string, string[]> | null = null;
const sylCache = new Map<string, number>();

function rhymeIndex(): Map<string, string[]> {
  if (index) return index;
  const m = new Map<string, string[]>();
  for (const [word, phones] of entries()) {
    const parts = phones.split(' ');
    const k = rhymeKeyOf(parts);
    if (!k) continue;
    const bucket = m.get(k);
    if (bucket) bucket.push(word);
    else m.set(k, [word]);
    sylCache.set(word, parts.filter((p) => /[0-2]$/.test(p)).length || 1);
  }
  index = m;
  return m;
}

function syllablesOf(word: string): number {
  return sylCache.get(word) ?? analyzeWord(word).count;
}
