import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transposeSymbol } from './transpose';

test('transposes a plain triad up', () => {
  assert.equal(transposeSymbol('C', 2), 'D');
});

test('transposes a minor seventh, keeping the quality suffix', () => {
  assert.equal(transposeSymbol('Am7', 3), 'Cm7');
});

test('wraps around the octave both directions', () => {
  assert.equal(transposeSymbol('B', 2), 'C#');
  assert.equal(transposeSymbol('C', -2), 'A#');
});

test('preserves flat spelling when the original used one', () => {
  assert.equal(transposeSymbol('Bb', 2), 'C');
  assert.equal(transposeSymbol('Eb7', -2), 'Db7');
});

test('transposes the bass note of a slash chord too', () => {
  assert.equal(transposeSymbol('C/E', 2), 'D/F#');
});

test('up then back down by the same amount round-trips exactly', () => {
  for (const symbol of ['Am7', 'F#maj7', 'Bbdim', 'G/B', 'C#m7b5']) {
    assert.equal(transposeSymbol(transposeSymbol(symbol, 5), -5), symbol);
  }
});

test('a bare key name transposes the same way', () => {
  assert.equal(transposeSymbol('Am', 3), 'Cm');
});

test('symbols with no leading note pass through unchanged', () => {
  assert.equal(transposeSymbol('N.C.', 4), 'N.C.');
});
