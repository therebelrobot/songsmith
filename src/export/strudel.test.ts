import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeStrudel } from './strudel';
import type { ChordProInput } from './chordpro';

function fixture(overrides: Partial<ChordProInput> = {}): ChordProInput {
  return {
    title: 'Leave The Light On',
    song_key: 'Am',
    tempo_bpm: 96,
    meter_num: 4,
    meter_den: 4,
    sections: [
      { name: 'Verse 1', bar_count: 2, lines: [] },
      { name: 'Chorus', bar_count: 1, lines: [] },
    ],
    chords: [
      { bar: 1, beat: 1, symbol: 'Am', duration_beats: 2, line_id: null, syllable_index: null },
      { bar: 1, beat: 3, symbol: 'F', duration_beats: 2, line_id: null, syllable_index: null },
      { bar: 2, beat: 1, symbol: 'C', duration_beats: 4, line_id: null, syllable_index: null },
      { bar: 3, beat: 1, symbol: 'G', duration_beats: 4, line_id: null, syllable_index: null },
    ],
    ...overrides,
  };
}

test('setcpm converts tempo/meter into bars-per-minute (4/4 @ 96bpm -> 24)', () => {
  const text = serializeStrudel(fixture());
  assert.match(text, /setcpm\(24\)/);
});

test('patterns are bare chord() calls — no n("0") prefix', () => {
  const text = serializeStrudel(fixture());
  assert.doesNotMatch(text, /n\("0"\)/);
  assert.match(text, /const verse_1 = chord\("<\[Am F\] C>"\)\.voicing\(\)/);
  assert.match(text, /const chorus = chord\("<G>"\)\.voicing\(\)/);
});

test('sections are sequenced with arrange() in bar_count-weighted order', () => {
  const text = serializeStrudel(fixture());
  assert.match(text, /arrange\(\s*\[2, verse_1\],\s*\[1, chorus\],?\s*\)\.sound\("piano"\)/);
});

test('a chord held across several bars renders once with the "!n" hold operator, not repeated or cut short into rests', () => {
  const text = serializeStrudel(
    fixture({
      sections: [{ name: 'Verse 1', bar_count: 4, lines: [] }],
      chords: [{ bar: 1, beat: 1, symbol: 'Cm', duration_beats: 16, line_id: null, syllable_index: null }],
    }),
  );
  assert.match(text, /const verse_1 = chord\("<Cm!4>"\)\.voicing\(\)/);
});

test('a held chord is clamped to the next onset, so it never swallows a later chord', () => {
  const text = serializeStrudel(
    fixture({
      sections: [{ name: 'Verse 1', bar_count: 4, lines: [] }],
      chords: [
        { bar: 1, beat: 1, symbol: 'Cm', duration_beats: 16, line_id: null, syllable_index: null },
        { bar: 3, beat: 1, symbol: 'G', duration_beats: 8, line_id: null, syllable_index: null },
      ],
    }),
  );
  assert.match(text, /const verse_1 = chord\("<Cm!2 G!2>"\)\.voicing\(\)/);
});

test('a gap with no chord placed at all compresses to "~!n"', () => {
  const text = serializeStrudel(
    fixture({
      sections: [{ name: 'Verse 1', bar_count: 4, lines: [] }],
      chords: [{ bar: 1, beat: 1, symbol: 'Am', duration_beats: 4, line_id: null, syllable_index: null }],
    }),
  );
  assert.match(text, /const verse_1 = chord\("<Am ~!3>"\)\.voicing\(\)/);
});

test('a single empty bar still renders as a bare "~", not "~!1"', () => {
  const text = serializeStrudel(
    fixture({
      sections: [{ name: 'Verse 1', bar_count: 2, lines: [] }],
      chords: [{ bar: 1, beat: 1, symbol: 'Am', duration_beats: 4, line_id: null, syllable_index: null }],
    }),
  );
  assert.match(text, /const verse_1 = chord\("<Am ~>"\)\.voicing\(\)/);
});

test("chords past every section's bar_count fold into a trailing step instead of being dropped", () => {
  const text = serializeStrudel(
    fixture({
      sections: [{ name: 'Verse 1', bar_count: 1, lines: [] }],
      chords: [
        { bar: 1, beat: 1, symbol: 'Am', duration_beats: 4, line_id: null, syllable_index: null },
        { bar: 2, beat: 1, symbol: 'G', duration_beats: 4, line_id: null, syllable_index: null },
      ],
    }),
  );
  assert.match(text, /unassigned trailing bars 2-2/);
  assert.match(text, /const unassigned_trailing_bars = chord\("<G>"\)\.voicing\(\)/);
  assert.match(text, /\[1, unassigned_trailing_bars\]/);
});

test('missing tempo defaults to 120bpm and notes it in a comment', () => {
  const text = serializeStrudel(fixture({ tempo_bpm: null }));
  assert.match(text, /tempo: 120 bpm \(default — song has no tempo set\)/);
  assert.match(text, /setcpm\(30\)/); // 120 / 4
});

test("a section's lyric lines appear as // comments, in order, directly above its pattern", () => {
  const text = serializeStrudel(
    fixture({
      sections: [
        {
          name: 'Verse 1',
          bar_count: 2,
          lines: [
            { id: 1, text: 'Never meant to let you go', words: [], timed: true, start_bar: 1 },
            { id: 2, text: 'Counting every hour alone', words: [], timed: true, start_bar: 2 },
          ],
        },
        { name: 'Chorus', bar_count: 1, lines: [] },
      ],
    }),
  );
  assert.match(
    text,
    /\/\/ Verse 1 \(bars 1-2\)\n\/\/ Never meant to let you go\n\/\/ Counting every hour alone\nconst verse_1/,
  );
});

test('a blank lyric line (section-break placeholder) is skipped rather than rendered as an empty comment', () => {
  const text = serializeStrudel(
    fixture({
      sections: [
        {
          name: 'Verse 1',
          bar_count: 1,
          lines: [{ id: 1, text: '', words: [], timed: false, start_bar: null }],
        },
      ],
      chords: [{ bar: 1, beat: 1, symbol: 'Am', duration_beats: 4, line_id: null, syllable_index: null }],
    }),
  );
  assert.match(text, /\/\/ Verse 1 \(bar 1\)\nconst verse_1/);
});
