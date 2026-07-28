import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineTiming } from './resolve';

test('no anchors: one beat per syllable from the line start', () => {
  const out = resolveLineTiming({ startBar: 2, startBeat: 1, syllableOffsets: [] }, 4, 4);
  assert.deepEqual(out, [
    { index: 0, bar: 2, beat: 1 },
    { index: 1, bar: 2, beat: 2 },
    { index: 2, bar: 2, beat: 3 },
    { index: 3, bar: 2, beat: 4 },
  ]);
});

test('one anchor at the start: extends forward at default spacing', () => {
  const out = resolveLineTiming(
    { startBar: 1, startBeat: 1, syllableOffsets: [{ index: 0, offset: 0 }] },
    3,
    4,
  );
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 1 },
    { index: 1, bar: 1, beat: 2 },
    { index: 2, bar: 1, beat: 3 },
  ]);
});

test('one anchor in the middle: extends both directions at default spacing', () => {
  const out = resolveLineTiming(
    { startBar: 1, startBeat: 1, syllableOffsets: [{ index: 2, offset: 8 }] },
    5,
    4,
  );
  // offset 8 sixteenths = beat 3; syllable spacing is 1 beat (4 sixteenths) either side
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 1 },
    { index: 1, bar: 1, beat: 2 },
    { index: 2, bar: 1, beat: 3 },
    { index: 3, bar: 1, beat: 4 },
    { index: 4, bar: 2, beat: 1 },
  ]);
});

test('anchors at both ends: interpolates linearly between them', () => {
  const out = resolveLineTiming(
    {
      startBar: 1,
      startBeat: 1,
      syllableOffsets: [
        { index: 0, offset: 0 },
        { index: 4, offset: 16 }, // 16 sixteenths = 4 beats later
      ],
    },
    5,
    4,
  );
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 1 },
    { index: 1, bar: 1, beat: 2 },
    { index: 2, bar: 1, beat: 3 },
    { index: 3, bar: 1, beat: 4 },
    { index: 4, bar: 2, beat: 1 },
  ]);
});

test('two anchors not spanning the whole line: extends past the last at its local spacing', () => {
  const out = resolveLineTiming(
    {
      startBar: 1,
      startBeat: 1,
      syllableOffsets: [
        { index: 0, offset: 0 },
        { index: 1, offset: 8 },
      ],
    },
    4,
    4,
  );
  // spacing between the two anchors is 8 sixteenths/step; syllables 2 and 3
  // extend past the last anchor at that same spacing
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 1 },
    { index: 1, bar: 1, beat: 3 },
    { index: 2, bar: 2, beat: 1 },
    { index: 3, bar: 2, beat: 3 },
  ]);
});

test('stale anchor indices from a shortened line are dropped, not crashed on', () => {
  const out = resolveLineTiming(
    {
      startBar: 1,
      startBeat: 1,
      syllableOffsets: [
        { index: 0, offset: 0 },
        { index: 9, offset: 999 }, // stale: line now has only 3 syllables
      ],
    },
    3,
    4,
  );
  // only the index-0 anchor survives -> single-anchor behaviour
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 1 },
    { index: 1, bar: 1, beat: 2 },
    { index: 2, bar: 1, beat: 3 },
  ]);
});

test('negative-index and non-integer-index anchors are dropped', () => {
  const out = resolveLineTiming(
    {
      startBar: 1,
      startBeat: 1,
      syllableOffsets: [{ index: -1, offset: 0 }, { index: 1.5, offset: 0 }],
    },
    2,
    4,
  );
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 1 },
    { index: 1, bar: 1, beat: 2 },
  ]);
});

test('zero syllables resolves to an empty grid', () => {
  assert.deepEqual(resolveLineTiming({ startBar: 1, startBeat: 1, syllableOffsets: [] }, 0, 4), []);
});

test('duplicate-index anchors: the last one wins', () => {
  const out = resolveLineTiming(
    {
      startBar: 1,
      startBeat: 1,
      syllableOffsets: [
        { index: 0, offset: 0 },
        { index: 0, offset: 4 },
      ],
    },
    2,
    4,
  );
  assert.deepEqual(out, [
    { index: 0, bar: 1, beat: 2 },
    { index: 1, bar: 1, beat: 3 },
  ]);
});
