import { Chord, Key, Note } from 'tonal';

/** A symbol is valid when tonal can resolve it to at least one pitch class. */
export function isValidChordSymbol(symbol: string): boolean {
  const trimmed = symbol.trim();
  if (!trimmed) return false;
  const chord = Chord.get(trimmed);
  return !chord.empty && chord.notes.length > 0;
}

const KEY_RE = /^([A-G][#b]?)(m)?$/;

/**
 * Diatonic triads for the song's key, e.g. "Am" -> the seven natural minor
 * triads. Returns [] for no key, or a key tonal can't parse — never guesses.
 */
export function diatonicChordsForKey(songKey: string | null): readonly string[] {
  if (!songKey) return [];
  const m = KEY_RE.exec(songKey.trim());
  if (!m) return [];
  const tonic = m[1] as string;
  const minor = m[2] === 'm';
  if (minor) {
    const key = Key.minorKey(tonic);
    return key.natural.triads;
  }
  const key = Key.majorKey(tonic);
  return key.triads;
}

export interface VoicedTone {
  /** Hz, from tonal's Note.freq. */
  frequency: number;
}

/**
 * Simplified voicing (phase 3, deliberately no inversions or voice leading —
 * that's phase 5): root in octave 3, every remaining chord tone in octave 4.
 * Returns [] for a symbol tonal can't parse.
 */
export function voiceChord(symbol: string): VoicedTone[] {
  const chord = Chord.get(symbol.trim());
  if (chord.empty || chord.notes.length === 0) return [];
  return chord.notes
    .map((pitchClass, i) => Note.freq(`${pitchClass}${i === 0 ? 3 : 4}`))
    .filter((f): f is number => typeof f === 'number' && f > 0)
    .map((frequency) => ({ frequency }));
}
