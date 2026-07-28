import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeChords, type GridSyllableInput } from './leadsheet';

const line1: GridSyllableInput[] = [
  { line_id: 1, index: 0, bar: 1, beat: 1 },
  { line_id: 1, index: 1, bar: 1, beat: 2 },
  { line_id: 1, index: 2, bar: 1, beat: 3 },
  { line_id: 1, index: 3, bar: 1, beat: 4 },
];

test('chord before the first syllable lands on it', () => {
  const [placed] = placeChords(
    [{ id: 1, bar: 1, beat: 1, symbol: 'C', duration_beats: 4 }],
    line1,
    4,
  );
  assert.deepEqual(placed, {
    id: 1,
    bar: 1,
    beat: 1,
    symbol: 'C',
    duration_beats: 4,
    line_id: 1,
    syllable_index: 0,
  });
});

test('chord after the last syllable is unplaced', () => {
  const [placed] = placeChords(
    [{ id: 1, bar: 2, beat: 1, symbol: 'C', duration_beats: 4 }],
    line1,
    4,
  );
  assert.equal(placed?.line_id, null);
  assert.equal(placed?.syllable_index, null);
});

test('chord exactly on a syllable lands on that syllable', () => {
  const [placed] = placeChords(
    [{ id: 1, bar: 1, beat: 3, symbol: 'G', duration_beats: 2 }],
    line1,
    4,
  );
  assert.equal(placed?.line_id, 1);
  assert.equal(placed?.syllable_index, 2);
});

test('two chords competing for one syllable both land on it', () => {
  const placed = placeChords(
    [
      { id: 1, bar: 1, beat: 1, symbol: 'C', duration_beats: 1 },
      { id: 2, bar: 1, beat: 1.5, symbol: 'F', duration_beats: 1 },
    ],
    line1,
    4,
  );
  assert.equal(placed[0]?.syllable_index, 0);
  assert.equal(placed[1]?.syllable_index, 1);
  // Tighten: both chords land before syllable 1 (beat 2) since there is no
  // syllable between beats 1 and 2 — the second chord (beat 1.5) also has to
  // skip to syllable index 1, same as the first would if placed later.
  const crowded = placeChords(
    [
      { id: 1, bar: 1, beat: 1.9, symbol: 'C', duration_beats: 0.5 },
      { id: 2, bar: 1, beat: 1.95, symbol: 'F', duration_beats: 0.5 },
    ],
    line1,
    4,
  );
  assert.equal(crowded[0]?.syllable_index, 1);
  assert.equal(crowded[1]?.syllable_index, 1);
});

test('a chord in a line with no timing at all is unplaced', () => {
  const [placed] = placeChords(
    [{ id: 1, bar: 1, beat: 1, symbol: 'C', duration_beats: 4 }],
    [],
    4,
  );
  assert.equal(placed?.line_id, null);
  assert.equal(placed?.syllable_index, null);
});

test('a chord in an empty bar (no nearby timed syllables) is unplaced', () => {
  // line1 occupies bar 1 only; a chord dropped into bar 5 with nothing after it is unplaced.
  const [placed] = placeChords(
    [{ id: 1, bar: 5, beat: 1, symbol: 'Am', duration_beats: 4 }],
    line1,
    4,
  );
  assert.equal(placed?.line_id, null);
  assert.equal(placed?.syllable_index, null);
});

test('a chord between two timed lines lands on the next line, not the previous one', () => {
  const line2: GridSyllableInput[] = [
    { line_id: 2, index: 0, bar: 3, beat: 1 },
    { line_id: 2, index: 1, bar: 3, beat: 2 },
  ];
  const [placed] = placeChords(
    [{ id: 1, bar: 2, beat: 1, symbol: 'Dm', duration_beats: 4 }],
    [...line1, ...line2],
    4,
  );
  assert.equal(placed?.line_id, 2);
  assert.equal(placed?.syllable_index, 0);
});
