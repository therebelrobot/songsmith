import { phonemes } from './cmudict';

export interface Syllable {
  /** Orthographic chunk shown in the UI, e.g. "nev". Boundaries are heuristic. */
  text: string;
  /** 0 = unstressed, 1 = primary, 2 = secondary. -1 when the word is unknown. */
  stress: number;
}

export interface WordProsody {
  word: string;
  count: number;
  /** true when the count came from the dictionary, false when it was estimated. */
  known: boolean;
  syllables: Syllable[];
  /** Rhyme key: phonemes from the last stressed vowel to the end. */
  rhymeKey: string | null;
}

const VOWEL_RE = /[0-2]$/;

/** Count nuclei in an ARPAbet phoneme list. Vowel phonemes carry a stress digit. */
function nucleiOf(phones: string[]): number[] {
  const out: number[] = [];
  for (const p of phones) {
    const m = VOWEL_RE.exec(p);
    if (m) out.push(Number(m[0]));
  }
  return out;
}

/**
 * Fallback count for words the dictionary does not have (proper nouns, slang,
 * invented words — which songwriting produces constantly).
 */
function estimateCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  let groups = w.replace(/[^aeiouy]+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  // Silent terminal e: "make" is 1, not 2. Not silent after a consonant+le: "table".
  if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) groups -= 1;
  // -es / -ed are usually not their own nucleus unless preceded by a sibilant/stop.
  if (/(?:[^aeiouylr])(?:es|ed)$/.test(w) && !/(?:[sxzcg]h?|[td])(?:es|ed)$/.test(w)) groups -= 1;
  return Math.max(1, groups);
}

/**
 * Split a word into `count` orthographic chunks. The count is authoritative
 * (it comes from CMU); the boundaries are best-effort. Splitting after each
 * vowel group approximates English syllable onsets well enough for a UI where
 * the user can drag boundaries.
 */
function splitOrthographic(word: string, count: number): string[] {
  if (count <= 1) return [word];
  const boundaries: number[] = [];
  const lower = word.toLowerCase();
  let i = 0;
  while (i < lower.length && boundaries.length < count - 1) {
    // advance to the end of a vowel run
    while (i < lower.length && !'aeiouy'.includes(lower[i] as string)) i++;
    while (i < lower.length && 'aeiouy'.includes(lower[i] as string)) i++;
    if (i >= lower.length) break;
    // leave one consonant as the onset of the next chunk when two are available
    let cut = i;
    let cons = 0;
    while (cut < lower.length && !'aeiouy'.includes(lower[cut] as string)) {
      cons++;
      cut++;
    }
    if (cut >= lower.length) break;
    boundaries.push(cons >= 2 ? i + cons - 1 : i);
    i = cut;
  }
  if (boundaries.length === 0) {
    // No usable vowel structure — chop into even chunks so the count still matches.
    const size = Math.ceil(word.length / count);
    const even: string[] = [];
    for (let k = 0; k < word.length; k += size) even.push(word.slice(k, k + size));
    while (even.length < count) even.push('');
    return even.slice(0, count);
  }
  const parts: string[] = [];
  let prev = 0;
  for (const b of boundaries) {
    parts.push(word.slice(prev, b));
    prev = b;
  }
  parts.push(word.slice(prev));
  while (parts.length < count) parts.push('');
  return parts.slice(0, count);
}

/** Phonemes from the last stressed vowel to the end. Perfect-rhyme key. */
export function rhymeKeyOf(phones: string[]): string | null {
  let idx = -1;
  for (let i = phones.length - 1; i >= 0; i--) {
    const p = phones[i] as string;
    if (p.endsWith('1')) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    for (let i = phones.length - 1; i >= 0; i--) {
      if (VOWEL_RE.test(phones[i] as string)) {
        idx = i;
        break;
      }
    }
  }
  if (idx === -1) return null;
  // Strip stress digits so "IY1 NG" and "IY0 NG" rhyme.
  return phones
    .slice(idx)
    .map((p) => p.replace(/[0-2]$/, ''))
    .join(' ');
}

export function analyzeWord(word: string): WordProsody {
  const bare = word.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, '');
  if (bare.length === 0) {
    return { word, count: 0, known: false, syllables: [], rhymeKey: null };
  }
  const phones = phonemes(bare);
  if (!phones) {
    const count = estimateCount(bare);
    return {
      word: bare,
      count,
      known: false,
      syllables: splitOrthographic(bare, count).map((text) => ({ text, stress: -1 })),
      rhymeKey: null,
    };
  }
  const nuclei = nucleiOf(phones);
  const count = Math.max(1, nuclei.length);
  const chunks = splitOrthographic(bare, count);
  return {
    word: bare,
    count,
    known: true,
    syllables: chunks.map((text, i) => ({ text, stress: nuclei[i] ?? 0 })),
    rhymeKey: rhymeKeyOf(phones),
  };
}

export interface LineProsody {
  text: string;
  count: number;
  words: WordProsody[];
  /** Rhyme key of the final word — what the rhyme scheme is computed from. */
  rhymeKey: string | null;
  /** true when every word was found in the dictionary. */
  fullyKnown: boolean;
}

export function analyzeLine(text: string): LineProsody {
  const words = text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map(analyzeWord)
    .filter((w) => w.count > 0);
  const last = words.at(-1);
  return {
    text,
    count: words.reduce((a, w) => a + w.count, 0),
    words,
    rhymeKey: last?.rhymeKey ?? null,
    fullyKnown: words.every((w) => w.known),
  };
}
