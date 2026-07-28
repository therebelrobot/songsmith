import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMidi, encodeVLQ } from './midi';

test('VLQ boundary: 127 encodes as one byte, 128 rolls to two', () => {
  assert.deepEqual(encodeVLQ(127), [0x7f]);
  assert.deepEqual(encodeVLQ(128), [0x81, 0x00]);
});

test('VLQ boundary: 16383 is the last two-byte value, 16384 needs three', () => {
  assert.deepEqual(encodeVLQ(16383), [0xff, 0x7f]);
  assert.deepEqual(encodeVLQ(16384), [0x81, 0x80, 0x00]);
});

test('VLQ of zero is a single zero byte', () => {
  assert.deepEqual(encodeVLQ(0), [0x00]);
});

test('header chunk is a well-formed 14-byte MThd, format 0, 1 track', () => {
  const bytes = buildMidi({ tempo_bpm: 120, meter_num: 4, meter_den: 4, chords: [] });
  const header = [...bytes.slice(0, 14)];
  assert.deepEqual(header.slice(0, 4), [0x4d, 0x54, 0x68, 0x64]); // "MThd"
  assert.deepEqual(header.slice(4, 8), [0, 0, 0, 6]); // header length = 6
  assert.deepEqual(header.slice(8, 10), [0, 0]); // format 0
  assert.deepEqual(header.slice(10, 12), [0, 1]); // 1 track
  assert.deepEqual(header.slice(12, 14), [0x01, 0xe0]); // division = 480 ticks/quarter
});

test('MTrk chunk length matches its actual byte count', () => {
  const bytes = buildMidi({
    tempo_bpm: 120,
    meter_num: 4,
    meter_den: 4,
    chords: [{ bar: 1, beat: 1, duration_beats: 4, notes: [48, 64, 67] }],
  });
  const trackTag = [...bytes.slice(14, 18)];
  assert.deepEqual(trackTag, [0x4d, 0x54, 0x72, 0x6b]); // "MTrk"
  const declaredLen = (bytes[18]! << 24) | (bytes[19]! << 16) | (bytes[20]! << 8) | bytes[21]!;
  assert.equal(declaredLen, bytes.length - 22);
});

test('tempo and time-signature meta events are present with the right values', () => {
  const bytes = buildMidi({ tempo_bpm: 100, meter_num: 3, meter_den: 8, chords: [] });
  const body = [...bytes.slice(22)];
  // both metas have delta-time 0, so they open the track directly
  assert.deepEqual(body.slice(0, 3), [0x00, 0xff, 0x51]); // delta 0, tempo meta
  assert.equal(body[3], 0x03); // 3-byte payload
  const usPerQuarter = (body[4]! << 16) | (body[5]! << 8) | body[6]!;
  assert.equal(usPerQuarter, Math.round(60_000_000 / 100));

  assert.deepEqual(body.slice(7, 10), [0x00, 0xff, 0x58]); // delta 0, time sig meta
  assert.equal(body[10], 0x04);
  assert.equal(body[11], 3); // numerator
  assert.equal(body[12], 3); // denominator as power of 2: 8 = 2^3
});

test('every note-on has a matching note-off, and events end with End of Track', () => {
  const bytes = buildMidi({
    tempo_bpm: 120,
    meter_num: 4,
    meter_den: 4,
    chords: [
      { bar: 1, beat: 1, duration_beats: 2, notes: [48, 64, 67] }, // C triad
      { bar: 1, beat: 3, duration_beats: 2, notes: [57, 60, 64, 67] }, // Am7
    ],
  });
  const body = [...bytes.slice(22)];

  let i = 0;
  let onCount = 0;
  let offCount = 0;
  let sawEndOfTrack = false;
  while (i < body.length) {
    // skip delta-time VLQ
    while ((body[i]! & 0x80) !== 0) i++;
    i++;
    const status = body[i]!;
    if (status === 0xff) {
      const type = body[i + 1]!;
      const len = body[i + 2]!;
      if (type === 0x2f) sawEndOfTrack = true;
      i += 3 + len;
    } else if ((status & 0xf0) === 0x90) {
      onCount++;
      i += 3;
    } else if ((status & 0xf0) === 0x80) {
      offCount++;
      i += 3;
    } else {
      throw new Error(`unexpected status byte 0x${status.toString(16)} at offset ${i}`);
    }
  }
  assert.ok(sawEndOfTrack, 'track must end with an End of Track meta event');
  assert.equal(onCount, 7); // C triad (3 tones) + Am7 (4 tones)
  assert.equal(offCount, onCount);
});

test('a chord with no resolved notes (e.g. an unparseable symbol upstream) still produces a valid file', () => {
  const bytes = buildMidi({
    tempo_bpm: 120,
    meter_num: 4,
    meter_den: 4,
    chords: [{ bar: 1, beat: 1, duration_beats: 4, notes: [] }],
  });
  const body = [...bytes.slice(22)];
  // Only the two metas + End of Track: tempo(7) + time-sig(8) + EOT(4) = 19 bytes.
  assert.equal(body.length, 7 + 8 + 4);
});

test('a null-safe tempo of 1 does not divide by zero or produce a negative duration', () => {
  assert.doesNotThrow(() => buildMidi({ tempo_bpm: 1, meter_num: 4, meter_den: 4, chords: [] }));
});
