/**
 * Pure chord-symbol -> semitone-offset voicing, hand-rolled to match what the
 * client's playback does with tonal (web/src/chords.ts's voiceChord): root
 * (or, for a slash chord, the bass note) in one octave, every other chord
 * tone in the next octave up, no inversions. Octave assignment only depends
 * on POSITION (first vs rest) not on interval size, so a 9th and a 2nd land
 * in the same place — that already matches tonal's own simplified voicing,
 * which is why this table only needs semitone offsets mod 12, not full
 * interval names.
 *
 * Quality table covers standard triads/sevenths/extensions verified against
 * tonal's chord dictionary (see the phase 4 handoff's note on reconciling
 * spellings). Symbols outside this set fall back to a major or minor triad
 * guessed from the suffix's first letter — a documented limitation, not a
 * silent wrong answer: it never claims 7ths/9ths/etc. it didn't parse.
 */

import { ROOT_RE, BASS_RE, SEMITONE_OF } from './notes';

interface Quality {
  re: RegExp;
  intervals: number[];
}

// Ordered most-specific first: a shorter alias (e.g. "m") must not shadow a
// longer one (e.g. "maj7", "m7b5") that starts with the same letter.
const QUALITIES: Quality[] = [
  { re: /^(maj7|Maj7|M7|Δ7?)$/, intervals: [0, 4, 7, 11] },
  { re: /^(maj9|Maj9|M9)$/, intervals: [0, 4, 7, 11, 2] },
  { re: /^(maj13|Maj13|M13)$/, intervals: [0, 4, 7, 11, 2, 9] },
  { re: /^(m7b5|m7-5|min7b5|ø7?)$/, intervals: [0, 3, 6, 10] },
  { re: /^(m6\/9|min6\/9)$/, intervals: [0, 3, 7, 9, 2] },
  { re: /^(m6|min6|-6)$/, intervals: [0, 3, 7, 9] },
  { re: /^(m7|min7|-7)$/, intervals: [0, 3, 7, 10] },
  { re: /^(m9|min9|-9)$/, intervals: [0, 3, 7, 10, 2] },
  { re: /^(m11|min11|-11)$/, intervals: [0, 3, 7, 10, 2, 5] },
  { re: /^(m13|min13|-13)$/, intervals: [0, 3, 7, 10, 2, 9] },
  { re: /^(madd9|minadd9|-add9)$/, intervals: [0, 3, 7, 2] },
  { re: /^(dim7|°7|o7)$/, intervals: [0, 3, 6, 9] },
  { re: /^(dim|°|o)$/, intervals: [0, 3, 6] },
  { re: /^(aug|\+)$/, intervals: [0, 4, 8] },
  { re: /^(7#5|7\+5|aug7)$/, intervals: [0, 4, 8, 10] },
  { re: /^(7b5|7-5)$/, intervals: [0, 4, 6, 10] },
  { re: /^(7sus4|7sus)$/, intervals: [0, 5, 7, 10] },
  { re: /^(sus2)$/, intervals: [0, 2, 7] },
  { re: /^(sus4|sus)$/, intervals: [0, 5, 7] },
  { re: /^(6\/9|69)$/, intervals: [0, 4, 7, 9, 2] },
  { re: /^(6)$/, intervals: [0, 4, 7, 9] },
  { re: /^(add9)$/, intervals: [0, 4, 7, 2] },
  { re: /^(maj|M)$/, intervals: [0, 4, 7] },
  { re: /^(9)$/, intervals: [0, 4, 7, 10, 2] },
  { re: /^(11)$/, intervals: [0, 7, 10, 2, 5] },
  { re: /^(13)$/, intervals: [0, 4, 7, 10, 2, 9] },
  { re: /^(7)$/, intervals: [0, 4, 7, 10] },
  { re: /^(m|min|-)$/, intervals: [0, 3, 7] },
  { re: /^$/, intervals: [0, 4, 7] },
];

function qualityIntervals(quality: string): number[] | null {
  for (const q of QUALITIES) {
    if (q.re.test(quality)) return q.intervals;
  }
  // Unrecognized suffix: best-effort major/minor guess rather than silence.
  if (/^m(?!aj)/.test(quality)) return [0, 3, 7];
  if (/^[A-Za-z]/.test(quality)) return [0, 4, 7];
  return null;
}

/**
 * Semitone offsets from C (0-11) for every tone in `symbol`, ordered with the
 * root (or slash bass, if present) first — matching tonal's own note order
 * for the same symbols, which is what makes the octave-3/octave-4 split line
 * up with playback. Returns [] for a symbol with no leading note letter
 * ("N.C.") or one whose root doesn't resolve.
 */
export function chordSemitones(symbol: string): number[] {
  const trimmed = symbol.trim();
  const rootMatch = ROOT_RE.exec(trimmed);
  if (!rootMatch) return [];
  const root = rootMatch[0];
  const rootSemitone = SEMITONE_OF[root];
  if (rootSemitone === undefined) return [];

  const bassMatch = BASS_RE.exec(trimmed);
  const quality = trimmed.slice(root.length, bassMatch ? bassMatch.index : undefined);
  const intervals = qualityIntervals(quality);
  if (!intervals) return [];

  const tones = intervals.map((iv) => (rootSemitone + iv) % 12);

  if (!bassMatch) return tones;
  const bassNote = bassMatch[1] as string;
  const bassSemitone = SEMITONE_OF[bassNote];
  if (bassSemitone === undefined) return tones;

  // Mirrors tonal's slash-chord note order: rotate to start at the bass if
  // it's already a chord tone, otherwise prepend it ahead of the full chord.
  const idx = tones.indexOf(bassSemitone);
  if (idx === -1) return [bassSemitone, ...tones];
  return [...tones.slice(idx), ...tones.slice(0, idx)];
}
