/**
 * The one hand-rolled note-name table on the server: a 12-entry semitone
 * lookup plus the regexes for a leadsheet symbol's root and slash bass.
 * Shared by src/timing/voicing.ts (MIDI export) so there is exactly one
 * server-side idea of "what semitone is this note name" — see the phase 4
 * handoff note about the client (tonal) and server disagreeing on spelling.
 */

export const SEMITONE_OF: Record<string, number> = {
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

export const ROOT_RE = /^[A-G][#b]?/;
export const BASS_RE = /\/([A-G][#b]?)/;
