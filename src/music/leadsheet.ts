/**
 * Pure resolver: song-wide chords + the resolved syllable grid -> which
 * syllable (if any) each chord lands on. No database or Fastify imports here
 * — the client renders inline chord placement straight from
 * GET /api/songs/:id/grid, which calls this, so the two can't drift.
 *
 * Placement rule: for each chord, find the syllable whose resolved position
 * is nearest at-or-after the chord's own bar/beat, across every line in the
 * grid. A chord with no such syllable (past the last line, or in a bar with
 * no timed lines at all) is unplaced — the client renders those on the bar
 * ruler instead of inline.
 */

export interface ChordInput {
  id: number;
  bar: number;
  beat: number;
  symbol: string;
  duration_beats: number;
}

export interface GridSyllableInput {
  line_id: number;
  index: number;
  bar: number;
  beat: number;
}

export interface PlacedChord extends ChordInput {
  line_id: number | null;
  syllable_index: number | null;
}

/** Absolute position in beats from the top of the song, for ordering comparisons only. */
function positionOf(bar: number, beat: number, beatsPerBar: number): number {
  return (bar - 1) * beatsPerBar + (beat - 1);
}

/**
 * Place every chord on the nearest at-or-after syllable, across all lines.
 * `syllables` should be every resolved syllable from every timed line in the
 * grid (a line with no timing simply contributes no entries, so its chords
 * fall through to the next timed line or go unplaced).
 */
export function placeChords(
  chords: ChordInput[],
  syllables: GridSyllableInput[],
  beatsPerBar: number,
): PlacedChord[] {
  const sorted = syllables
    .map((s) => ({ ...s, pos: positionOf(s.bar, s.beat, beatsPerBar) }))
    .sort((a, b) => a.pos - b.pos || a.line_id - b.line_id || a.index - b.index);

  return chords.map((c) => {
    const cpos = positionOf(c.bar, c.beat, beatsPerBar);
    const landing = sorted.find((s) => s.pos >= cpos) ?? null;
    return {
      ...c,
      line_id: landing?.line_id ?? null,
      syllable_index: landing?.index ?? null,
    };
  });
}
