/**
 * Pure resolver: sparse syllable anchors -> absolute bar/beat per syllable.
 * No database or Fastify imports here — the client renders straight from
 * GET /api/songs/:id/grid, which calls this, so the two can't drift.
 */

export interface SyllableAnchor {
  /** ordinal into analyzeLine().words.flatMap(w => w.syllables) */
  index: number;
  /** sixteenth notes from the line's start */
  offset: number;
}

export interface LineTimingInput {
  startBar: number;
  startBeat: number;
  syllableOffsets: SyllableAnchor[];
}

export interface ResolvedSyllable {
  index: number;
  bar: number;
  beat: number;
}

const SIXTEENTHS_PER_BEAT = 4;

/**
 * Spacing used when there's no neighbouring anchor to interpolate from: one
 * beat per syllable. Applies to an unanchored line and to extrapolating past
 * a lone anchor.
 */
const DEFAULT_SIXTEENTHS_PER_SYLLABLE = 4;

/** Drop out-of-range/non-integer indices (stale after a rewrite), dedupe by index, sort ascending. */
function normalizeAnchors(raw: SyllableAnchor[], syllableCount: number): SyllableAnchor[] {
  const byIndex = new Map<number, number>();
  for (const a of raw) {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= syllableCount) continue;
    byIndex.set(a.index, a.offset);
  }
  return [...byIndex.entries()]
    .map(([index, offset]) => ({ index, offset }))
    .sort((a, b) => a.index - b.index);
}

/** Sixteenth-note offsets from the line's start, one per syllable, for every index 0..syllableCount-1. */
function resolveOffsets(anchors: SyllableAnchor[], syllableCount: number): number[] {
  const offsets = new Array<number>(syllableCount);

  if (anchors.length === 0) {
    for (let i = 0; i < syllableCount; i++) offsets[i] = i * DEFAULT_SIXTEENTHS_PER_SYLLABLE;
    return offsets;
  }

  if (anchors.length === 1) {
    const a = anchors[0] as SyllableAnchor;
    for (let i = 0; i < syllableCount; i++) {
      offsets[i] = a.offset + (i - a.index) * DEFAULT_SIXTEENTHS_PER_SYLLABLE;
    }
    return offsets;
  }

  const first = anchors[0] as SyllableAnchor;
  const second = anchors[1] as SyllableAnchor;
  const firstSpacing = (second.offset - first.offset) / (second.index - first.index);
  for (let i = 0; i < first.index; i++) {
    offsets[i] = first.offset - (first.index - i) * firstSpacing;
  }

  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k] as SyllableAnchor;
    const b = anchors[k + 1] as SyllableAnchor;
    const spacing = (b.offset - a.offset) / (b.index - a.index);
    for (let i = a.index; i <= b.index; i++) {
      offsets[i] = a.offset + (i - a.index) * spacing;
    }
  }

  const last = anchors[anchors.length - 1] as SyllableAnchor;
  const secondLast = anchors[anchors.length - 2] as SyllableAnchor;
  const lastSpacing = (last.offset - secondLast.offset) / (last.index - secondLast.index);
  for (let i = last.index + 1; i < syllableCount; i++) {
    offsets[i] = last.offset + (i - last.index) * lastSpacing;
  }

  return offsets;
}

/**
 * Resolve a line's sparse anchors into an absolute bar/beat for every
 * syllable. `beatsPerBar` comes from the song's meter_num — a beat is
 * whatever note value meter_den names, and syllable offsets are always
 * counted in quarters of that beat ("sixteenth notes" per the schema
 * comment), so this doesn't need meter_den itself.
 */
export function resolveLineTiming(
  timing: LineTimingInput,
  syllableCount: number,
  beatsPerBar: number,
): ResolvedSyllable[] {
  if (syllableCount <= 0) return [];

  const anchors = normalizeAnchors(timing.syllableOffsets, syllableCount);
  const offsets = resolveOffsets(anchors, syllableCount);

  const sixteenthsPerBar = beatsPerBar * SIXTEENTHS_PER_BEAT;
  const startSixteenths =
    (timing.startBar - 1) * sixteenthsPerBar + (timing.startBeat - 1) * SIXTEENTHS_PER_BEAT;

  return offsets.map((offset, index) => {
    const abs = startSixteenths + offset;
    const bar = Math.floor(abs / sixteenthsPerBar) + 1;
    const withinBar = abs - (bar - 1) * sixteenthsPerBar;
    const beat = 1 + withinBar / SIXTEENTHS_PER_BEAT;
    return { index, bar, beat };
  });
}
