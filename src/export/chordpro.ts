/**
 * ChordPro serialize/parse. Pure functions only — no database or Fastify
 * imports — so the round trip (export -> import -> export) can be tested
 * without a server, and the export route can't drift from the import route.
 *
 * Chord placement reuses src/music/leadsheet.ts's output (the caller passes
 * already-placed chords) and src/music/resolve.ts's bar/beat math (the
 * importer calls it directly) rather than reimplementing either.
 */

import { analyzeLine, type WordProsody } from '../prosody/syllables';
import { resolveLineTiming } from '../music/resolve';

// ---------- shared: syllable -> character span within a line's raw text ----------

interface SyllableSpan {
  index: number;
  start: number;
  end: number;
}

/**
 * Map each syllable's ordinal index (as in analyzeLine().words.flatMap(w =>
 * w.syllables)) to its character range within `text`. Locates each word by
 * `indexOf` from a monotonically advancing cursor — words appear in `text` in
 * the same order they appear in `words`, so this can't get confused by
 * repeated words, and degrades gracefully (falls back to the cursor) if the
 * cached `words` ever falls out of sync with `text`.
 */
function syllableSpans(text: string, words: WordProsody[]): SyllableSpan[] {
  const spans: SyllableSpan[] = [];
  let cursor = 0;
  let ordinal = 0;
  for (const w of words) {
    const found = text.indexOf(w.word, cursor);
    let pos = found === -1 ? cursor : found;
    for (const s of w.syllables) {
      spans.push({ index: ordinal, start: pos, end: pos + s.text.length });
      pos += s.text.length;
      ordinal++;
    }
    cursor = pos;
  }
  return spans;
}

function sectionKind(name: string): 'chorus' | 'bridge' | 'verse' {
  const n = name.toLowerCase();
  if (n.includes('chorus')) return 'chorus';
  if (n.includes('bridge')) return 'bridge';
  return 'verse';
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ================================= serialize =================================

export interface ChordProInputLine {
  id: number;
  text: string;
  words: WordProsody[];
  /** true when this line has a line_timing row, i.e. appears in the grid */
  timed: boolean;
  start_bar: number | null;
}

export interface ChordProInputSection {
  name: string;
  bar_count: number | null;
  lines: ChordProInputLine[];
}

export interface ChordProInputChord {
  bar: number;
  beat: number;
  symbol: string;
  /** placement from src/music/leadsheet.ts's placeChords — null means unplaced (instrumental) */
  line_id: number | null;
  syllable_index: number | null;
}

export interface ChordProInput {
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  meter_num: number;
  meter_den: number;
  sections: ChordProInputSection[];
  chords: ChordProInputChord[];
}

function renderLyricLine(text: string, words: WordProsody[], chordsByIndex: Map<number, string[]>): string {
  const spans = syllableSpans(text, words);
  if (spans.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    const symbols = chordsByIndex.get(span.index);
    if (symbols) out += symbols.map((s) => `[${s}]`).join('');
    out += text.slice(span.start, span.end);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out;
}

interface BarGroup {
  bar: number;
  symbols: string[];
}

function groupByBar(chords: { bar: number; beat: number; symbol: string }[]): BarGroup[] {
  const byBar = new Map<number, { bar: number; beat: number; symbol: string }[]>();
  for (const c of chords) {
    const list = byBar.get(c.bar) ?? [];
    list.push(c);
    byBar.set(c.bar, list);
  }
  return [...byBar.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bar, list]) => ({
      bar,
      symbols: [...list].sort((a, b) => a.beat - b.beat).map((c) => c.symbol),
    }));
}

/**
 * Render the leadsheet as ChordPro text. Chords with a line/syllable land
 * inline immediately before that syllable; chords with no placement (past the
 * last line, or in a bar with no timed lines — see leadsheet.ts) render as a
 * chord-only line, one per bar, positioned by bar order relative to the
 * section's timed lyric lines. An untimed lyric line has no bar to compare
 * against, so instrumental chords queue past it and flush at the next timed
 * line (or the section's end) — sections that mix untimed lyric lines with
 * instrumental bars may not round-trip their relative order perfectly; this
 * is a known limitation, not a bug in the common case (fully timed, or
 * chords-only, sections).
 */
export function serializeChordPro(input: ChordProInput): string {
  const out: string[] = [];
  out.push(`{title: ${input.title}}`);
  if (input.song_key) out.push(`{key: ${input.song_key}}`);
  if (input.tempo_bpm != null) out.push(`{tempo: ${input.tempo_bpm}}`);
  out.push(`{time: ${input.meter_num}/${input.meter_den}}`);

  let cursor = 1;
  const ranges = input.sections.map((s) => {
    const start = cursor;
    cursor += s.bar_count ?? 0;
    return { start, end: cursor };
  });

  const chordsByLine = new Map<number, { index: number; bar: number; beat: number; symbol: string }[]>();
  const unplaced: { bar: number; beat: number; symbol: string }[] = [];
  for (const c of input.chords) {
    if (c.line_id !== null && c.syllable_index !== null) {
      const list = chordsByLine.get(c.line_id) ?? [];
      list.push({ index: c.syllable_index, bar: c.bar, beat: c.beat, symbol: c.symbol });
      chordsByLine.set(c.line_id, list);
    } else {
      unplaced.push({ bar: c.bar, beat: c.beat, symbol: c.symbol });
    }
  }

  input.sections.forEach((section, si) => {
    const kind = sectionKind(section.name);
    out.push('');
    out.push(`{start_of_${kind}: ${section.name}}`);

    const range = ranges[si]!;
    const isLast = si === input.sections.length - 1;
    const here = unplaced.filter((c) => (c.bar >= range.start && c.bar < range.end) || (isLast && c.bar >= range.end));
    const groups = groupByBar(here);
    let hi = 0;
    const flushUpTo = (bar: number | null) => {
      while (hi < groups.length && (bar === null || groups[hi]!.bar <= bar)) {
        out.push(groups[hi]!.symbols.map((s) => `[${s}]`).join(''));
        hi++;
      }
    };

    for (const line of section.lines) {
      if (line.timed && line.start_bar !== null) flushUpTo(line.start_bar);
      const perIndex = new Map<number, string[]>();
      for (const c of (chordsByLine.get(line.id) ?? []).sort((a, b) => a.bar - b.bar || a.beat - b.beat)) {
        const list = perIndex.get(c.index) ?? [];
        list.push(c.symbol);
        perIndex.set(c.index, list);
      }
      out.push(renderLyricLine(line.text, line.words, perIndex));
    }
    flushUpTo(null);

    out.push(`{end_of_${kind}}`);
  });

  return out.join('\n') + '\n';
}

// ================================== parse ==================================

export interface ChordProLyricItem {
  kind: 'lyric';
  text: string;
  words: WordProsody[];
  syllable_count: number;
  rhyme_key: string | null;
  /** sparse: syllable ordinal -> chord symbols (file order) that precede it */
  anchors: { index: number; symbols: string[] }[];
}

export interface ChordProInstrumentalItem {
  kind: 'instrumental';
  symbols: string[];
}

export type ChordProContentItem = ChordProLyricItem | ChordProInstrumentalItem;

export interface ChordProParsedSection {
  name: string;
  items: ChordProContentItem[];
}

export interface ChordProParseResult {
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  meter_num: number;
  meter_den: number;
  sections: ChordProParsedSection[];
  warnings: string[];
}

const DIRECTIVE_RE = /^\{([a-zA-Z_]+)(?:\s*:\s*(.*))?\}$/;
const TIME_RE = /^(\d+)\s*\/\s*(\d+)$/;

// Match the interactive API's own limits (SongCreate/SectionCreate/LineCreate/
// ChordCreate in src/types.ts) so an imported file can never write a row the
// UI itself couldn't have produced.
const MAX_TITLE = 200;
const MAX_KEY = 16;
const MAX_SECTION_NAME = 80;
const MAX_CHORD_SYMBOL = 24;

/** Strip `[Chord]` tags, returning the plain text and each tag's position within it. */
function stripChords(line: string): { text: string; marks: { pos: number; symbol: string }[] } {
  let text = '';
  const marks: { pos: number; symbol: string }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '[') {
      const end = line.indexOf(']', i);
      if (end === -1) {
        text += line.slice(i);
        break;
      }
      const symbol = line.slice(i + 1, end).trim();
      if (symbol.length > 0) marks.push({ pos: text.length, symbol });
      i = end + 1;
    } else {
      text += line[i];
      i++;
    }
  }
  return { text, marks };
}

/**
 * Parse ChordPro text into song metadata plus a sequence of content items per
 * section. Section environments ({start_of_verse}/{end_of_verse} and the
 * chorus/bridge equivalents) become sections; a file with none of those wraps
 * all its content lines into a single "Verse 1" section rather than refusing
 * the import — a plain chord sheet with no structure markers is the common
 * case for a hand-written file.
 */
export function parseChordPro(text: string): ChordProParseResult {
  const rawLines = text.split(/\r\n|\r|\n/);

  let title = 'Untitled';
  let song_key: string | null = null;
  let tempo_bpm: number | null = null;
  let meter_num = 4;
  let meter_den = 4;
  let sawTempo = false;
  let sawTime = false;

  const sections: ChordProParsedSection[] = [];
  let current: ChordProParsedSection | null = null;
  const leading: ChordProContentItem[] = [];

  const pushItem = (item: ChordProContentItem) => {
    if (current) current.items.push(item);
    else leading.push(item);
  };

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    const m = DIRECTIVE_RE.exec(trimmed);
    if (m) {
      const name = m[1]!.toLowerCase();
      const value = m[2]?.trim();
      if (name === 'title') {
        if (value) title = value.slice(0, MAX_TITLE);
        continue;
      }
      if (name === 'key') {
        song_key = value ? value.slice(0, MAX_KEY) : null;
        continue;
      }
      if (name === 'tempo') {
        const n = Number(value);
        if (value && !Number.isNaN(n)) {
          tempo_bpm = n;
          sawTempo = true;
        }
        continue;
      }
      if (name === 'time') {
        const mm = value ? TIME_RE.exec(value) : null;
        if (mm) {
          meter_num = Number(mm[1]);
          meter_den = Number(mm[2]);
          sawTime = true;
        }
        continue;
      }
      if (name.startsWith('start_of_')) {
        if (current) sections.push(current); // unclosed previous environment: close it implicitly
        const kind = name.slice('start_of_'.length);
        current = { name: (value || capitalize(kind)).slice(0, MAX_SECTION_NAME), items: [] };
        continue;
      }
      if (name.startsWith('end_of_')) {
        if (current) {
          sections.push(current);
          current = null;
        }
        continue;
      }
      continue; // unknown directive: ignore, forward-compatible
    }

    if (trimmed.length === 0) {
      if (current) pushItem({ kind: 'lyric', text: '', words: [], syllable_count: 0, rhyme_key: null, anchors: [] });
      continue; // blank line outside any section is just a structural separator
    }

    const { text: stripped, marks } = stripChords(raw);
    if (marks.length > 0 && stripped.trim().length === 0) {
      pushItem({ kind: 'instrumental', symbols: marks.map((mk) => mk.symbol) });
      continue;
    }

    const analyzed = analyzeLine(stripped);
    const spans = syllableSpans(stripped, analyzed.words);
    const anchorMap = new Map<number, string[]>();
    for (const mk of marks) {
      const span = spans.find((s) => s.start >= mk.pos) ?? spans.at(-1);
      if (!span) continue; // no syllables at all on this line (e.g. pure punctuation) — chord dropped
      const list = anchorMap.get(span.index) ?? [];
      list.push(mk.symbol);
      anchorMap.set(span.index, list);
    }
    pushItem({
      kind: 'lyric',
      text: stripped,
      words: analyzed.words,
      syllable_count: analyzed.count,
      rhyme_key: analyzed.rhymeKey,
      anchors: [...anchorMap.entries()].sort((a, b) => a[0] - b[0]).map(([index, symbols]) => ({ index, symbols })),
    });
  }
  if (current) sections.push(current);
  if (leading.length > 0) sections.unshift({ name: 'Verse 1', items: leading });
  if (sections.length === 0) sections.push({ name: 'Verse 1', items: [] });

  const warnings: string[] = [];
  if (!sawTime) warnings.push('no {time} directive found — defaulted to 4/4');
  if (!sawTempo) warnings.push('no {tempo} directive found — tempo left unset');

  return { title, song_key, tempo_bpm, meter_num, meter_den, sections, warnings };
}

// ============================ import layout planning ============================

export interface ImportChord {
  bar: number;
  beat: number;
  symbol: string;
  duration_beats: number;
}

export interface ImportLine {
  text: string;
  words: WordProsody[];
  syllable_count: number;
  rhyme_key: string | null;
  timing: { start_bar: number; start_beat: number; syllable_offsets: { index: number; offset: number }[] } | null;
}

export interface ImportSection {
  name: string;
  bar_count: number;
  lines: ImportLine[];
}

export interface ImportPlan {
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  meter_num: number;
  meter_den: number;
  sections: ImportSection[];
  chords: ImportChord[];
  warnings: string[];
}

const SIXTEENTHS_PER_SYLLABLE = 4;

/**
 * Turn a structural parse into absolute bar/beat placements. Layout rule:
 * one bar per content item (lyric line or instrumental line), in file order,
 * at the parsed meter — the "no {tempo}/{time} -> one bar per line at 4/4"
 * default from the phase 4 spec, applied uniformly whether or not those
 * directives were present (an explicit {time: 3/4} still gets one bar per
 * line, just in 3/4). A lyric line's chords anchor only the syllables that
 * had a [Chord] tag, at the same one-beat-per-syllable spacing
 * resolveLineTiming() itself defaults to — so the interpolated syllables
 * between anchors land exactly where they would with no anchors at all.
 */
export function planChordProImport(parsed: ChordProParseResult): ImportPlan {
  let bar = 1;
  const sections: ImportSection[] = [];
  const chords: ImportChord[] = [];
  const warnings = [...parsed.warnings];
  const droppedSymbols = new Set<string>();

  const pushChord = (c: ImportChord) => {
    if (c.symbol.length > MAX_CHORD_SYMBOL) {
      droppedSymbols.add(c.symbol);
      return;
    }
    chords.push(c);
  };

  for (const s of parsed.sections) {
    const lines: ImportLine[] = [];
    for (const item of s.items) {
      if (item.kind === 'instrumental') {
        const n = item.symbols.length;
        const share = parsed.meter_num / n;
        for (let i = 0; i < n; i++) {
          pushChord({ bar, beat: 1 + i * share, symbol: item.symbols[i]!, duration_beats: share });
        }
        bar += 1;
        continue;
      }

      if (item.anchors.length === 0) {
        lines.push({
          text: item.text,
          words: item.words,
          syllable_count: item.syllable_count,
          rhyme_key: item.rhyme_key,
          timing: null,
        });
        bar += 1;
        continue;
      }

      const syllableOffsets = item.anchors.map((a) => ({ index: a.index, offset: a.index * SIXTEENTHS_PER_SYLLABLE }));
      const resolved = resolveLineTiming({ startBar: bar, startBeat: 1, syllableOffsets }, item.syllable_count, parsed.meter_num);
      for (const a of item.anchors) {
        const pos = resolved.find((r) => r.index === a.index);
        if (!pos) continue;
        a.symbols.forEach((symbol, i) => {
          // Stacked chords on one syllable get a hair of separation so they
          // don't collide on the (song_id, bar, beat) unique index.
          pushChord({ bar: pos.bar, beat: pos.beat + i * 0.001, symbol, duration_beats: parsed.meter_num });
        });
      }
      lines.push({
        text: item.text,
        words: item.words,
        syllable_count: item.syllable_count,
        rhyme_key: item.rhyme_key,
        timing: { start_bar: bar, start_beat: 1, syllable_offsets: syllableOffsets },
      });
      bar += 1;
    }
    sections.push({ name: s.name, bar_count: s.items.length, lines });
  }

  if (droppedSymbols.size > 0) {
    warnings.push(`dropped ${droppedSymbols.size} chord symbol(s) longer than ${MAX_CHORD_SYMBOL} characters`);
  }

  return {
    title: parsed.title,
    song_key: parsed.song_key,
    tempo_bpm: parsed.tempo_bpm,
    meter_num: parsed.meter_num,
    meter_den: parsed.meter_den,
    sections,
    chords,
    warnings,
  };
}
