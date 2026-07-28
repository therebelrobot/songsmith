import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Note, Interval } from 'tonal';
import { toNumber, fromNumber } from './nashville';
import { transposeChordSymbol } from './chords';

test('all seven diatonic degrees in a major key (C)', () => {
  assert.equal(toNumber('C', 'C'), '1');
  assert.equal(toNumber('Dm', 'C'), '2');
  assert.equal(toNumber('Em', 'C'), '3');
  assert.equal(toNumber('F', 'C'), '4');
  assert.equal(toNumber('G', 'C'), '5');
  assert.equal(toNumber('Am', 'C'), '6');
  assert.equal(toNumber('Bdim', 'C'), '7');
});

test('all seven diatonic degrees in a minor key (Am)', () => {
  assert.equal(toNumber('Am', 'Am'), '1m');
  assert.equal(toNumber('Bdim', 'Am'), '2dim');
  assert.equal(toNumber('C', 'Am'), 'b3');
  assert.equal(toNumber('Dm', 'Am'), '4m');
  assert.equal(toNumber('Em', 'Am'), '5m');
  assert.equal(toNumber('F', 'Am'), 'b6');
  assert.equal(toNumber('G', 'Am'), 'b7');
});

test('a borrowed bVII chord', () => {
  assert.equal(toNumber('Bb', 'C'), 'b7');
});

test('a chord whose quality deviates from the diatonic default', () => {
  // D is major; degree 2 in C major is diatonically minor.
  assert.equal(toNumber('D', 'C'), '2maj');
  // Fm is minor; degree 4 in C major is diatonically major.
  assert.equal(toNumber('Fm', 'C'), '4m');
});

test('slash chords number both halves, bass relative to the chord root', () => {
  assert.equal(toNumber('C/G', 'C'), '1/5');
  assert.equal(toNumber('F/A', 'C'), '4/3');
});

test('a seventh and a sus4 carry the extension through verbatim', () => {
  assert.equal(toNumber('G7', 'C'), '57');
  assert.equal(toNumber('Dsus4', 'C'), '2sus4');
  assert.equal(toNumber('Cmaj7', 'C'), '1maj7');
});

test('an unparseable symbol passes through unchanged', () => {
  assert.equal(toNumber('N.C.', 'C'), 'N.C.');
  assert.equal(toNumber('Xyz123', 'C'), 'Xyz123');
});

test('fromNumber returns null for input that is not a valid number-chart symbol', () => {
  assert.equal(fromNumber('N.C.', 'C'), null);
  assert.equal(fromNumber('9', 'C'), null);
  assert.equal(fromNumber('Am', 'C'), null); // a letter name, not a number
});

test('fromNumber inverts toNumber examples directly', () => {
  assert.equal(fromNumber('2maj', 'C'), 'D');
  assert.equal(fromNumber('4m', 'C'), 'Fm');
  assert.equal(fromNumber('1/5', 'C'), 'C/G');
  assert.equal(fromNumber('4/3', 'C'), 'F/A');
  assert.equal(fromNumber('57', 'C'), 'G7');
  assert.equal(fromNumber('2sus4', 'C'), 'Dsus4');
  assert.equal(fromNumber('1maj7', 'C'), 'Cmaj7');
});

/** Builds the seven diatonic triads of a major key the same way a songwriter would spell them. */
function diatonicTriads(tonic: string): string[] {
  const semitonesByDegree = [0, 2, 4, 5, 7, 9, 11];
  const quality: ('' | 'm' | 'dim')[] = ['', 'm', 'm', '', '', 'm', 'dim'];
  return semitonesByDegree.map((semitones, i) => Note.transpose(tonic, Interval.fromSemitones(semitones)) + quality[i]);
}

for (const key of ['C', 'G', 'F', 'Bb', 'E']) {
  test(`fromNumber(toNumber(x)) === x across the diatonic set in ${key}`, () => {
    for (const symbol of diatonicTriads(key)) {
      const number = toNumber(symbol, key);
      const back = fromNumber(number, key);
      assert.equal(back, symbol, `${symbol} -> ${number} -> ${back}`);
    }
  });
}

test('the transpose invariant: the numbers chart is unchanged by transposing letter symbols and key together', () => {
  const key = 'Am';
  const symbols = ['Am', 'F', 'C', 'G', 'Em', 'Dm7', 'G/B'];
  const before = symbols.map((s) => toNumber(s, key));

  for (const semitones of [1, -3, 7]) {
    const newKey = transposeChordSymbol(key, semitones);
    const newSymbols = symbols.map((s) => transposeChordSymbol(s, semitones));
    const after = newSymbols.map((s) => toNumber(s, newKey));
    assert.deepEqual(after, before, `semitones=${semitones}`);
  }
});
