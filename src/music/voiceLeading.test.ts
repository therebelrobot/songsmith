import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  voiceLeadChords,
  rootPositionVoicing,
  resolveVoicings,
  REGISTER_MIN,
  REGISTER_MAX,
} from './voiceLeading';

/** Same nearest-neighbor metric the module scores candidates with, used here to grade the whole sequence. */
function totalMotion(voicings: number[][]): number {
  let sum = 0;
  for (let i = 1; i < voicings.length; i++) {
    const prev = voicings[i - 1] as number[];
    const cur = voicings[i] as number[];
    sum += cur.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(p - n))), 0);
  }
  return sum;
}

test('I-V-vi-IV in C: voice-led motion stays low and beats root-position-only', () => {
  const progression = ['C', 'G', 'Am', 'F'].map((symbol) => ({ symbol }));
  const voiced = voiceLeadChords(progression);
  const rootOnly = progression.map((c) => rootPositionVoicing(c.symbol));

  const voicedMotion = totalMotion(voiced);
  const rootMotion = totalMotion(rootOnly);

  assert.ok(voicedMotion < 15, `expected voice-led motion below 15, got ${voicedMotion}`);
  assert.ok(
    voicedMotion < rootMotion,
    `voice-led motion (${voicedMotion}) should beat root-position-only (${rootMotion})`,
  );
});

test('a repeated chord produces zero motion — it reuses the previous voicing exactly', () => {
  const [first, second] = voiceLeadChords([{ symbol: 'C' }, { symbol: 'C' }]);
  assert.deepEqual(first, second);
  assert.equal(totalMotion([first as number[], second as number[]]), 0);
});

test('a tritone root jump stays inside the register window', () => {
  const voicings = voiceLeadChords([{ symbol: 'C' }, { symbol: 'F#' }]);
  for (const voicing of voicings) {
    for (const note of voicing) {
      assert.ok(note >= REGISTER_MIN && note <= REGISTER_MAX, `${note} outside [${REGISTER_MIN}, ${REGISTER_MAX}]`);
    }
  }
});

test('C/G keeps G in the bass regardless of what scores best above it', () => {
  const [, slash] = voiceLeadChords([{ symbol: 'Am' }, { symbol: 'C/G' }]);
  const bass = (slash as number[])[0] as number;
  assert.equal(bass % 12, 7); // G
});

test('the same input twice produces byte-identical output', () => {
  const progression = ['C', 'G', 'Am', 'F', 'C/E', 'Dm7', 'G7', 'C'].map((symbol) => ({ symbol }));
  const a = voiceLeadChords(progression);
  const b = voiceLeadChords(progression);
  assert.deepEqual(a, b);
});

test('every voicing produced by a real progression stays within the register window', () => {
  const progression = ['C', 'G', 'Am', 'F', 'Dm7', 'G7', 'Cmaj7'].map((symbol) => ({ symbol }));
  for (const voicing of voiceLeadChords(progression)) {
    for (const note of voicing) {
      assert.ok(note >= REGISTER_MIN && note <= REGISTER_MAX);
    }
  }
});

test('a symbol tonal cannot parse produces no notes rather than a guess', () => {
  const [voicing] = voiceLeadChords([{ symbol: 'N.C.' }]);
  assert.deepEqual(voicing, []);
});

test('an unvoiceable predecessor does not poison the next chord — it reseeds instead', () => {
  const voicings = voiceLeadChords([{ symbol: 'N.C.' }, { symbol: 'C' }]);
  assert.deepEqual(voicings[0], []);
  assert.ok((voicings[1] as number[]).length > 0);
});

test('rootPositionVoicing: root (or slash bass) in octave 3, the rest in octave 4, no inversions', () => {
  assert.deepEqual(rootPositionVoicing('C'), [48, 64, 67]); // C3, E4, G4
  assert.deepEqual(rootPositionVoicing('C/G'), [55, 60, 64]); // G3, C4, E4
  assert.deepEqual(rootPositionVoicing('N.C.'), []);
});

test('resolveVoicings dispatches on the toggle without mixing the two algorithms', () => {
  const chords = [{ symbol: 'C' }, { symbol: 'G' }];
  assert.deepEqual(resolveVoicings(chords, false), chords.map((c) => rootPositionVoicing(c.symbol)));
  assert.deepEqual(resolveVoicings(chords, true), voiceLeadChords(chords));
});
