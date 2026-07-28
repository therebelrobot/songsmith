/**
 * Hand-rolled Type-0 Standard MIDI File writer — no library, per the phase 4
 * spec: a 14-byte MThd header plus one MTrk chunk of delta-time-prefixed
 * events. Pure function: takes the chord track and returns bytes.
 *
 * Voicing matches playback (web/src/chords.ts's voiceChord): root, or the
 * bass note for a slash chord, in octave 3; every other chord tone in octave
 * 4; no inversions. src/timing/voicing.ts is the server-side equivalent of
 * that function, verified against tonal so the exported file sounds like
 * what the app plays.
 */

import { chordSemitones } from '../timing/voicing';

const TICKS_PER_QUARTER = 480;
const ROOT_OCTAVE = 3;
const OTHER_OCTAVE = 4;
const NOTE_ON_VELOCITY = 96;
const NOTE_OFF_VELOCITY = 64;
const CHANNEL = 0;

export interface MidiChordInput {
  bar: number;
  beat: number;
  symbol: string;
  duration_beats: number;
}

export interface MidiSongInput {
  /** Already resolved by the caller — null-tempo defaulting is the route's job, not this pure function's. */
  tempo_bpm: number;
  meter_num: number;
  meter_den: number;
  chords: MidiChordInput[];
}

/** MIDI note number for a pitch class (0-11) in a given octave, C4 = 60. */
function midiNote(pitchClass: number, octave: number): number {
  return (octave + 1) * 12 + pitchClass;
}

/** Variable-length quantity encoding (MIDI delta-time / meta-length format). */
export function encodeVLQ(value: number): number[] {
  if (value < 0 || !Number.isInteger(value)) throw new Error(`VLQ cannot encode ${value}`);
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0) & 0xff);
}

interface NoteEvent {
  tick: number;
  kind: 'on' | 'off';
  note: number;
}

/**
 * Build the Type-0 MIDI bytes for the chord track. Bar/beat are converted to
 * ticks via the song's own meter (a "beat" is whatever note value meter_den
 * names, same convention as src/timing/resolve.ts), not via tempo — tempo
 * only sets the playback-speed meta event.
 */
export function buildMidi(input: MidiSongInput): Uint8Array {
  const ticksPerBeat = TICKS_PER_QUARTER * (4 / input.meter_den);
  const ticksPerBar = input.meter_num * ticksPerBeat;

  const events: NoteEvent[] = [];
  for (const c of input.chords) {
    const startTick = Math.round((c.bar - 1) * ticksPerBar + (c.beat - 1) * ticksPerBeat);
    const durationTicks = Math.max(1, Math.round(c.duration_beats * ticksPerBeat));
    const tones = chordSemitones(c.symbol);
    tones.forEach((pitchClass, i) => {
      const note = midiNote(pitchClass, i === 0 ? ROOT_OCTAVE : OTHER_OCTAVE);
      events.push({ tick: startTick, kind: 'on', note });
      events.push({ tick: startTick + durationTicks, kind: 'off', note });
    });
  }
  events.sort((a, b) => a.tick - b.tick || (a.kind === b.kind ? a.note - b.note : a.kind === 'off' ? -1 : 1));

  const track: number[] = [];

  const usPerQuarter = Math.max(1, Math.round(60_000_000 / input.tempo_bpm));
  track.push(...encodeVLQ(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  const dd = Math.round(Math.log2(input.meter_den));
  track.push(...encodeVLQ(0), 0xff, 0x58, 0x04, input.meter_num & 0xff, dd & 0xff, 24, 8);

  let prevTick = 0;
  for (const ev of events) {
    track.push(...encodeVLQ(ev.tick - prevTick));
    prevTick = ev.tick;
    if (ev.kind === 'on') track.push(0x90 | CHANNEL, ev.note, NOTE_ON_VELOCITY);
    else track.push(0x80 | CHANNEL, ev.note, NOTE_OFF_VELOCITY);
  }

  track.push(...encodeVLQ(0), 0xff, 0x2f, 0x00);

  const header = [...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(TICKS_PER_QUARTER)];
  const trackChunk = [...ascii('MTrk'), ...u32(track.length), ...track];

  return new Uint8Array([...header, ...trackChunk]);
}
