import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLine, type WordProsody } from '../prosody/syllables';
import { resolveLineTiming } from '../timing/resolve';
import { placeChords, type ChordInput } from '../timing/leadsheet';
import {
  serializeChordPro,
  parseChordPro,
  planChordProImport,
  type ChordProInput,
  type ImportPlan,
} from './chordpro';

// ---------- fixture scaffolding: simulates the DB-backed shape the real
// export route builds, using only the pure functions the route itself calls
// (resolveLineTiming, placeChords), so this test exercises the exact same
// maths as production without needing sqlite. ----------

interface FixtureLine {
  id: number;
  text: string;
}
interface FixtureSection {
  name: string;
  bar_count: number | null;
  lines: FixtureLine[];
}
interface FixtureTiming {
  line_id: number;
  start_bar: number;
  start_beat: number;
  syllable_offsets: { index: number; offset: number }[];
}
interface FixtureChord {
  bar: number;
  beat: number;
  symbol: string;
}
interface FixtureSong {
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  meter_num: number;
  meter_den: number;
  sections: FixtureSection[];
  timings: FixtureTiming[];
  chords: FixtureChord[];
}

function buildChordProInput(song: FixtureSong): ChordProInput {
  const beatsPerBar = song.meter_num;
  const timingByLine = new Map(song.timings.map((t) => [t.line_id, t]));
  const allLines = song.sections.flatMap((s) => s.lines);
  const wordsByLine = new Map<number, WordProsody[]>();
  const timedByLine = new Map<number, { timed: boolean; start_bar: number | null }>();
  const allSyllables: { line_id: number; index: number; bar: number; beat: number }[] = [];

  for (const line of allLines) {
    const analyzed = analyzeLine(line.text);
    wordsByLine.set(line.id, analyzed.words);
    const t = timingByLine.get(line.id);
    if (!t) {
      timedByLine.set(line.id, { timed: false, start_bar: null });
      continue;
    }
    timedByLine.set(line.id, { timed: true, start_bar: t.start_bar });
    const resolved = resolveLineTiming(
      { startBar: t.start_bar, startBeat: t.start_beat, syllableOffsets: t.syllable_offsets },
      analyzed.count,
      beatsPerBar,
    );
    for (const s of resolved) allSyllables.push({ line_id: line.id, index: s.index, bar: s.bar, beat: s.beat });
  }

  const chordInputs: ChordInput[] = song.chords.map((c, i) => ({ id: i + 1, bar: c.bar, beat: c.beat, symbol: c.symbol, duration_beats: 4 }));
  const placed = placeChords(chordInputs, allSyllables, beatsPerBar);

  return {
    title: song.title,
    song_key: song.song_key,
    tempo_bpm: song.tempo_bpm,
    meter_num: song.meter_num,
    meter_den: song.meter_den,
    sections: song.sections.map((s) => ({
      name: s.name,
      bar_count: s.bar_count,
      lines: s.lines.map((l) => ({
        id: l.id,
        text: l.text,
        words: wordsByLine.get(l.id)!,
        timed: timedByLine.get(l.id)!.timed,
        start_bar: timedByLine.get(l.id)!.start_bar,
      })),
    })),
    chords: placed.map((p) => ({ bar: p.bar, beat: p.beat, symbol: p.symbol, line_id: p.line_id, syllable_index: p.syllable_index })),
  };
}

function planToFixture(plan: ImportPlan): FixtureSong {
  let nextId = 1;
  const sections: FixtureSection[] = [];
  const timings: FixtureTiming[] = [];
  for (const s of plan.sections) {
    const lines: FixtureLine[] = [];
    for (const l of s.lines) {
      const id = nextId++;
      lines.push({ id, text: l.text });
      if (l.timing) timings.push({ line_id: id, ...l.timing });
    }
    sections.push({ name: s.name, bar_count: s.bar_count, lines });
  }
  return {
    title: plan.title,
    song_key: plan.song_key,
    tempo_bpm: plan.tempo_bpm,
    meter_num: plan.meter_num,
    meter_den: plan.meter_den,
    sections,
    timings,
    chords: plan.chords.map((c) => ({ bar: c.bar, beat: c.beat, symbol: c.symbol })),
  };
}

/** export -> import -> export; returns the (asserted-identical) text. */
function roundTrip(fixture: FixtureSong): string {
  const text1 = serializeChordPro(buildChordProInput(fixture));
  const plan = planChordProImport(parseChordPro(text1));
  const text2 = serializeChordPro(buildChordProInput(planToFixture(plan)));
  assert.equal(text2, text1);
  return text1;
}

test('round trip: full timing, chords on several syllables across two sections', () => {
  const fixture: FixtureSong = {
    title: 'Leave The Light On',
    song_key: 'Am',
    tempo_bpm: 96,
    meter_num: 4,
    meter_den: 4,
    sections: [
      {
        name: 'Verse 1',
        bar_count: 2,
        lines: [
          { id: 1, text: 'Never meant to let you go' },
          { id: 2, text: 'Counting every hour alone' },
        ],
      },
      {
        name: 'Chorus',
        bar_count: 1,
        lines: [{ id: 3, text: 'Leave the light on' }],
      },
    ],
    timings: [
      { line_id: 1, start_bar: 1, start_beat: 1, syllable_offsets: [{ index: 0, offset: 0 }] },
      { line_id: 2, start_bar: 2, start_beat: 1, syllable_offsets: [{ index: 0, offset: 0 }] },
      { line_id: 3, start_bar: 3, start_beat: 1, syllable_offsets: [{ index: 0, offset: 0 }] },
    ],
    chords: [
      { bar: 1, beat: 1, symbol: 'Am' },
      { bar: 1, beat: 3, symbol: 'F' },
      { bar: 2, beat: 1, symbol: 'C' },
      { bar: 3, beat: 1, symbol: 'G' },
    ],
  };
  const text = roundTrip(fixture);
  assert.match(text, /\{title: Leave The Light On\}/);
  assert.match(text, /\{key: Am\}/);
  assert.match(text, /\[Am\]Never/);
  assert.match(text, /\{start_of_chorus: Chorus\}/);
});

test('round trip: no timing at all — plain lyrics, no chords, no line_timing rows', () => {
  const fixture: FixtureSong = {
    title: 'Sketch',
    song_key: null,
    tempo_bpm: null,
    meter_num: 4,
    meter_den: 4,
    sections: [
      {
        name: 'Verse 1',
        bar_count: null,
        lines: [
          { id: 1, text: 'Just a draft for now' },
          { id: 2, text: 'nothing pinned yet' },
        ],
      },
    ],
    timings: [],
    chords: [],
  };
  const text = roundTrip(fixture);
  assert.doesNotMatch(text, /\[/);
  assert.doesNotMatch(text, /\{key:/);
  assert.doesNotMatch(text, /\{tempo:/);
});

test('round trip: a trailing instrumental section with no lyric lines at all', () => {
  // leadsheet.ts's placement rule attaches every chord to the nearest
  // syllable at-or-after it, across the whole song — so a chord only ends up
  // genuinely unplaced (instrumental) when it falls after the *last* timed
  // syllable anywhere in the song. A turnaround/outro after the vocals is the
  // representable case; a chord before the first sung syllable always glues
  // onto it instead (that's a different, deliberate scenario, covered by the
  // "stacked chords on one syllable" test below).
  const fixture: FixtureSong = {
    title: 'Turnaround',
    song_key: 'G',
    tempo_bpm: 120,
    meter_num: 4,
    meter_den: 4,
    sections: [
      { name: 'Verse 1', bar_count: 1, lines: [{ id: 1, text: 'Here we go' }] },
      { name: 'Outro', bar_count: 2, lines: [] },
    ],
    timings: [{ line_id: 1, start_bar: 1, start_beat: 1, syllable_offsets: [{ index: 0, offset: 0 }] }],
    chords: [
      { bar: 1, beat: 1, symbol: 'C' }, // lands inline on "Here"
      { bar: 2, beat: 1, symbol: 'D' }, // after the last syllable -> unplaced -> instrumental
      { bar: 3, beat: 1, symbol: 'G' }, // same
    ],
  };
  const text = roundTrip(fixture);
  assert.match(text, /\[C\]Here we go/);
  assert.match(text, /\{start_of_verse: Outro\}\n\[D\]\n\[G\]\n\{end_of_verse\}/);
});

test('round trip: a syllable count that shrank after the anchor was set (stale anchor)', () => {
  // line_id 1 was anchored at syllable index 4 back when the text had 5+
  // syllables ("Counting every hour that you were gone"); it's since been
  // trimmed down to 3 syllables. resolveLineTiming must drop the stale
  // anchor rather than crash, and export must reflect the current text.
  const fixture: FixtureSong = {
    title: 'Trimmed',
    song_key: null,
    tempo_bpm: 100,
    meter_num: 4,
    meter_den: 4,
    sections: [{ name: 'Verse 1', bar_count: 1, lines: [{ id: 1, text: 'Counting hours now' }] }],
    timings: [
      {
        line_id: 1,
        start_bar: 1,
        start_beat: 1,
        syllable_offsets: [
          { index: 0, offset: 0 },
          { index: 4, offset: 999 }, // stale: current text has far fewer syllables
        ],
      },
    ],
    chords: [{ bar: 1, beat: 1, symbol: 'Dm' }],
  };
  const text = roundTrip(fixture);
  assert.match(text, /\[Dm\]/);
  assert.match(text, /Counting hours now/);
  assert.match(text, /\{title: Trimmed\}/);
});

// ---------- focused unit tests ----------

test('header directives omit unset fields and always include title/time', () => {
  const input: ChordProInput = {
    title: 'Bare',
    song_key: null,
    tempo_bpm: null,
    meter_num: 3,
    meter_den: 4,
    sections: [{ name: 'Verse 1', bar_count: null, lines: [] }],
    chords: [],
  };
  const text = serializeChordPro(input);
  assert.match(text, /^\{title: Bare\}\n\{time: 3\/4\}\n/);
  assert.doesNotMatch(text, /\{key:/);
  assert.doesNotMatch(text, /\{tempo:/);
});

test('section kind is derived from the name (chorus/bridge/else-verse)', () => {
  const input: ChordProInput = {
    title: 'T',
    song_key: null,
    tempo_bpm: null,
    meter_num: 4,
    meter_den: 4,
    sections: [
      { name: 'Pre-Chorus', bar_count: 0, lines: [] },
      { name: 'Bridge', bar_count: 0, lines: [] },
      { name: 'Outro', bar_count: 0, lines: [] },
    ],
    chords: [],
  };
  const text = serializeChordPro(input);
  assert.match(text, /\{start_of_chorus: Pre-Chorus\}\n\{end_of_chorus\}/);
  assert.match(text, /\{start_of_bridge: Bridge\}\n\{end_of_bridge\}/);
  assert.match(text, /\{start_of_verse: Outro\}\n\{end_of_verse\}/);
});

test('parse: a file with no section directives becomes one Verse 1 section', () => {
  const parsed = parseChordPro('{title: Plain}\n\nJust a [C]plain chord sheet\nwith no [G]structure\n');
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0]!.name, 'Verse 1');
  assert.equal(parsed.warnings.length, 2); // no {time}, no {tempo}
});

test('parse: a chord-only line becomes an instrumental item, not a lyric line', () => {
  const parsed = parseChordPro('{start_of_verse: Intro}\n[Am] [F]\n{end_of_verse}\n');
  const item = parsed.sections[0]!.items[0]!;
  assert.equal(item.kind, 'instrumental');
  if (item.kind === 'instrumental') assert.deepEqual(item.symbols, ['Am', 'F']);
});

test('parse: a chord tag past the last syllable attaches to the last syllable rather than being dropped', () => {
  const parsed = parseChordPro('{start_of_verse: V}\nGo[C]\n{end_of_verse}\n');
  const item = parsed.sections[0]!.items[0]!;
  assert.equal(item.kind, 'lyric');
  if (item.kind === 'lyric') {
    assert.equal(item.text, 'Go');
    assert.equal(item.anchors.length, 1);
  }
});

test('planChordProImport gives stacked chords on one syllable distinct beats', () => {
  const parsed = parseChordPro('{start_of_verse: V}\n[C][F]Go\n{end_of_verse}\n');
  const plan = planChordProImport(parsed);
  assert.equal(plan.chords.length, 2);
  assert.equal(plan.chords[0]!.bar, plan.chords[1]!.bar);
  assert.notEqual(plan.chords[0]!.beat, plan.chords[1]!.beat);
});
