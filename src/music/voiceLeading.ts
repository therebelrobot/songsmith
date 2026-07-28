/**
 * Pure voice-leading engine: chord symbols -> MIDI note arrays. No database
 * or Fastify imports — the grid endpoint and MIDI export both call this, so
 * playback and the exported file can't disagree (see the phase 5 handoff).
 *
 * Built on tonal for pitch math only (Chord.get, Note.chroma, Note.midi).
 * @tonaljs/voice-leading's only export (topNoteDiff) picks a voicing by
 * comparing just the top note to the previous voicing's top note, and
 * @tonaljs/voicing is a dictionary-driven jazz-voicing builder (drop-2,
 * rootless, etc.) — both out of scope and neither fits "score by total
 * pairwise motion, clamp to a register window, pin slash-chord basses", so
 * the search below is hand-rolled instead.
 */

import { Chord, Note } from 'tonal';

export const REGISTER_MIN = 48; // C3
export const REGISTER_MAX = 84; // C6

export interface VoicingInput {
  symbol: string;
}

interface ChordTones {
  /** Pitch classes in tonal's own order — already bass-first for a slash chord. */
  pitchClasses: string[];
  /** True when the symbol named an explicit slash bass, e.g. "C/G". */
  bassPinned: boolean;
}

/** Returns null for a symbol tonal can't resolve to any notes (e.g. "N.C."). */
function chordTones(symbol: string): ChordTones | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const chord = Chord.get(trimmed);
  if (chord.empty || chord.notes.length === 0) return null;
  return { pitchClasses: chord.notes, bassPinned: chord.bass !== '' };
}

/**
 * Root position plus every inversion: each rotation puts a different chord
 * tone at the bottom. A slash chord pins the bass, so it gets exactly one
 * rotation — the one tonal already ordered with the named bass first.
 */
function rotations(tones: ChordTones): string[][] {
  if (tones.bassPinned) return [tones.pitchClasses];
  return tones.pitchClasses.map((_, r) => [
    ...tones.pitchClasses.slice(r),
    ...tones.pitchClasses.slice(0, r),
  ]);
}

/** Ascending semitone offsets from the bottom note, stacking each tone at the nearest pitch above the last. */
function closeShapeOffsets(rotated: string[]): number[] {
  const chromas = rotated.map((pc) => Note.chroma(pc) ?? 0);
  const offsets = [0];
  let last = 0;
  for (let i = 1; i < chromas.length; i++) {
    const prev = chromas[i - 1] as number;
    const cur = chromas[i] as number;
    const diff = (((cur - prev) % 12) + 12) % 12 || 12;
    last += diff;
    offsets.push(last);
  }
  return offsets;
}

/** Every octave placement of one rotation's shape that keeps all its notes inside the register window. */
function candidatesForRotation(rotated: string[]): number[][] {
  const offsets = closeShapeOffsets(rotated);
  const span = offsets[offsets.length - 1] as number;
  const bottomChroma = Note.chroma(rotated[0] as string) ?? 0;

  const candidates: number[][] = [];
  for (let bottom = REGISTER_MIN; bottom + span <= REGISTER_MAX; bottom++) {
    if (bottom % 12 !== bottomChroma) continue;
    candidates.push(offsets.map((o) => bottom + o));
  }
  return candidates;
}

function allCandidates(tones: ChordTones): number[][] {
  return rotations(tones).flatMap(candidatesForRotation);
}

/** Sum, for each note in `candidate`, of its distance to the nearest note in `prev` — zero when the two voicings match exactly. */
function motionScore(prev: number[], candidate: number[]): number {
  return candidate.reduce((sum, note) => sum + Math.min(...prev.map((p) => Math.abs(p - note))), 0);
}

const REGISTER_CENTER = (REGISTER_MIN + REGISTER_MAX) / 2;

/** No predecessor yet: root position, whichever octave placement centres closest to the middle of the window. */
function pickSeed(candidates: number[][]): number[] {
  if (candidates.length === 0) return [];
  return candidates.reduce((best, c) => {
    const center = ((c[0] as number) + (c[c.length - 1] as number)) / 2;
    const bestCenter = ((best[0] as number) + (best[best.length - 1] as number)) / 2;
    const dist = Math.abs(center - REGISTER_CENTER);
    const bestDist = Math.abs(bestCenter - REGISTER_CENTER);
    if (dist !== bestDist) return dist < bestDist ? c : best;
    return (c[0] as number) < (best[0] as number) ? c : best;
  });
}

/** Least total motion from `prev`; ties break on the lowest bass note so the result is deterministic. */
function pickBest(candidates: number[][], prev: number[]): number[] {
  if (candidates.length === 0) return [];
  return candidates.reduce((best, c) => {
    const score = motionScore(prev, c);
    const bestScore = motionScore(prev, best);
    if (score !== bestScore) return score < bestScore ? c : best;
    return (c[0] as number) < (best[0] as number) ? c : best;
  });
}

/**
 * Voice-lead a chord sequence: each chord gets the lowest-motion voicing
 * reachable from the previous chosen voicing, register-clamped, with a
 * repeated symbol reusing its predecessor's voicing exactly (zero motion)
 * and a slash chord's bass pinned. Deterministic — same input, same output.
 */
export function voiceLeadChords(chords: readonly VoicingInput[]): number[][] {
  const result: number[][] = [];
  let prevVoicing: number[] = [];
  let prevSymbol: string | null = null;

  for (const c of chords) {
    if (prevSymbol !== null && c.symbol === prevSymbol) {
      result.push(prevVoicing);
      continue;
    }

    const tones = chordTones(c.symbol);
    if (!tones) {
      result.push([]);
      prevVoicing = [];
      prevSymbol = c.symbol;
      continue;
    }

    const chosen =
      prevVoicing.length === 0
        ? pickSeed(candidatesForRotation(tones.pitchClasses))
        : pickBest(allCandidates(tones), prevVoicing);

    result.push(chosen);
    prevVoicing = chosen;
    prevSymbol = c.symbol;
  }

  return result;
}

/**
 * The toggle-off fallback: root (or slash bass) in octave 3, every other
 * chord tone in octave 4, no inversions — the behaviour phase 3/4 shipped.
 */
export function rootPositionVoicing(symbol: string): number[] {
  const tones = chordTones(symbol);
  if (!tones) return [];
  return tones.pitchClasses
    .map((pc, i) => Note.midi(`${pc}${i === 0 ? 3 : 4}`))
    .filter((n): n is number => typeof n === 'number');
}

/** Dispatches on the song's `voice_leading` toggle — the one call site the grid and MIDI export both go through. */
export function resolveVoicings(chords: readonly VoicingInput[], voiceLeading: boolean): number[][] {
  return voiceLeading ? voiceLeadChords(chords) : chords.map((c) => rootPositionVoicing(c.symbol));
}
