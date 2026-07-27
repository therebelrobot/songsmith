/**
 * Pure chord-symbol transposition: shifts the root (and, for slash chords,
 * the bass note) by N semitones and leaves the quality suffix untouched.
 * No database or Fastify imports — used directly by the transpose route.
 *
 * Deliberately not the tonal library: tonal is a frontend-only dependency
 * (see README/handoff), and shifting a leading note name by a semitone count
 * doesn't need a chord parser — a 12-entry lookup table does the whole job.
 */

const SHARP_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SCALE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const SEMITONE_OF: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

/** Transpose a bare note name ("C", "F#", "Bb"). Preserves the original's sharp/flat spelling. */
function transposeNote(note: string, semitones: number): string {
  const semitone = SEMITONE_OF[note];
  if (semitone === undefined) return note;
  const flat = note.length === 2 && note[1] === 'b';
  const scale = flat ? FLAT_SCALE : SHARP_SCALE;
  const next = (((semitone + semitones) % 12) + 12) % 12;
  return scale[next] as string;
}

const ROOT_RE = /^[A-G][#b]?/;
const BASS_RE = /\/([A-G][#b]?)/;

/**
 * Transpose a leadsheet chord symbol ("Am7", "F#maj7", "C/E") or a bare key
 * name ("Am", "F#"). Symbols that don't start with a note letter (e.g. a
 * "N.C." no-chord marker) pass through unchanged.
 */
export function transposeSymbol(symbol: string, semitones: number): string {
  const rootMatch = ROOT_RE.exec(symbol);
  if (!rootMatch) return symbol;
  const root = rootMatch[0];
  const rest = symbol.slice(root.length);
  const newRoot = transposeNote(root, semitones);
  const newRest = rest.replace(BASS_RE, (_match, bass: string) => `/${transposeNote(bass, semitones)}`);
  return newRoot + newRest;
}
