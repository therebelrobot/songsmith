import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The CMU Pronouncing Dictionary, vendored at data/cmudict-0.7b.txt (BSD-2-Clause,
 * see data/CMUDICT-LICENSE.txt). We parse it ourselves rather than depend on the
 * `cmudict` npm package: that package was last published in 2012, has no types,
 * and its parser walks the 3.6 MB buffer byte-by-byte with string concatenation.
 *
 * Loading is lazy — server boot stays fast, the first /api/prosody call pays the
 * parse cost once (~350 ms, ~45 MB resident on a Pi 4).
 */
let dict: Map<string, string> | null = null;

// Resolved from process.cwd(), not import.meta.url: esbuild bundles this module
// into dist/index.js, so an import.meta.url-derived path resolves relative to
// dist/, not to the repo root — that mismatch already broke this once in
// production. process.cwd() is stable across tsx (dev) and the bundled build.
function dictPath(): string {
  return process.env.SONGSMITH_CMUDICT ?? join(process.cwd(), 'data', 'cmudict-0.7b.txt');
}

function load(): Map<string, string> {
  if (dict) return dict;
  const raw = readFileSync(dictPath(), 'utf8');
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    if (line.length === 0 || line.startsWith(';;;')) continue;
    const sp = line.indexOf(' ');
    if (sp < 1) continue;
    let word = line.slice(0, sp);
    // Alternate pronunciations are keyed `word(2)`. Keep only the first.
    if (word.endsWith(')')) continue;
    word = word.toUpperCase();
    if (map.has(word)) continue;
    // Trailing "#" comments appear in the GitHub distribution.
    const hash = line.indexOf(' #', sp);
    const phones = (hash === -1 ? line.slice(sp + 1) : line.slice(sp + 1, hash)).trim();
    if (phones.length > 0) map.set(word, phones);
  }
  dict = map;
  return map;
}

/** Phonemes for a word, ARPAbet with stress digits. `null` if not in the dictionary. */
export function phonemes(word: string): string[] | null {
  const key = word.toUpperCase().replace(/[^A-Z'\-.]/g, '');
  if (key.length === 0) return null;
  const hit = load().get(key);
  return hit ? hit.split(' ') : null;
}

export function isLoaded(): boolean {
  return dict !== null;
}

export function entryCount(): number {
  return load().size;
}

/** Every (WORD, phoneme-string) pair. Used to build the rhyme index once. */
export function entries(): IterableIterator<[string, string]> {
  return load().entries();
}
