/**
 * Strudel/Tidal-style export: turns the resolved chord grid into a Strudel
 * (https://strudel.cc) pattern using its tonal-backed `.chord()` mini-notation
 * — the same chord symbols already stored on the song (see
 * src/music/voiceLeading.ts, which resolves them with the same tonal
 * library), so no symbol translation is needed.
 *
 * One Strudel cycle == one bar. A chord held across several bars (its
 * duration_beats spanning more than one bar) renders once with the "!n" hold
 * operator (e.g. "Cm!4") rather than repeating the symbol or, worse, leaving
 * the held-through bars silent. A genuine gap — bars with no chord placed at
 * all — compresses the same way with "~!n". A bar holding more than one
 * chord (distinct onsets, not a hold) nests them in `[...]`, evenly spaced —
 * mini-notation has no concept of "beat 2.5", so the exact beat position
 * from the grid isn't preserved there. This is a basic, lossy jumping-off
 * point for further editing in Strudel, not a lossless round trip like
 * ChordPro. Each section's lyric lines are dropped in as plain `//` comments
 * above its pattern — reference only, Strudel has no notion of sung lyrics.
 */

import type { ChordProInput } from './chordpro';

const DEFAULT_TEMPO_BPM = 120;

/** JS-identifier-safe variable name for a section; disambiguates repeated names (two "Verse") with a numeric suffix. */
function uniqueSlug(name: string, seen: Map<string, number>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'section';
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}_${n}`;
}

/** cycles-per-minute so one Strudel cycle plays for exactly one bar of the song's meter. */
function cyclesPerMinute(tempo_bpm: number, meter_num: number, meter_den: number): number {
  const quartersPerBar = meter_num * (4 / meter_den);
  return tempo_bpm / quartersPerBar;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Mini-notation reads a bare "/" followed by a digit as the slow-by-N
 * operator, so a slash chord with a numeric-looking bass (rare, but tonal
 * allows e.g. scale degrees) would get misparsed as a speed modifier rather
 * than a literal chord symbol — quoting forces it back to a literal.
 */
function mininotationSafe(symbol: string): string {
  return /\/\d/.test(symbol) ? `"${symbol}"` : symbol;
}

/** "Cm", or "Cm!4" when held for more than one bar — the mini-notation replicate operator, valid on any atom. */
function holdToken(symbol: string, bars: number): string {
  const safe = mininotationSafe(symbol);
  return bars > 1 ? `${safe}!${bars}` : safe;
}

interface ChordOnset {
  symbol: string;
  duration_beats: number;
}

/** Chords grouped by their onset bar, ordered by beat within a bar — bars with simultaneous onsets (a passing chord stack) keep every symbol. */
function onsetsByBar(chords: { bar: number; beat: number; symbol: string; duration_beats: number }[]): Map<number, ChordOnset[]> {
  const byBar = new Map<number, ChordOnset[]>();
  for (const c of [...chords].sort((a, b) => a.bar - b.bar || a.beat - b.beat)) {
    const list = byBar.get(c.bar) ?? [];
    list.push({ symbol: c.symbol, duration_beats: c.duration_beats });
    byBar.set(c.bar, list);
  }
  return byBar;
}

/** duration_beats (meter_den-note beats, same unit the DB stores) converted to whole bars, minimum 1. */
function barsHeld(duration_beats: number, beatsPerBar: number): number {
  return Math.max(1, Math.round(duration_beats / beatsPerBar));
}

/**
 * One mini-notation token per held span in [start, start + count): a chord
 * (optionally "!n"-held), a "[a b ...]" bracket for a bar with several
 * simultaneous onsets, or a "~"/"~!n" rest for bars with no chord at all.
 * The token count times each token's hold length always sums to exactly
 * `count`, so this always accounts for precisely the bars it was asked for.
 */
function barTokens(byBar: Map<number, ChordOnset[]>, start: number, count: number, beatsPerBar: number): string[] {
  const end = start + count;
  const onsetBars = [...byBar.keys()].filter((b) => b >= start && b < end).sort((a, b) => a - b);

  const tokens: string[] = [];
  let bar = start;
  let oi = 0;
  while (bar < end) {
    if (onsetBars[oi] === bar) {
      const onsets = byBar.get(bar)!;
      const nextOnsetBar = onsetBars[oi + 1] ?? end;
      if (onsets.length === 1) {
        const hold = Math.min(barsHeld(onsets[0]!.duration_beats, beatsPerBar), nextOnsetBar - bar, end - bar);
        tokens.push(holdToken(onsets[0]!.symbol, hold));
        bar += hold;
      } else {
        tokens.push(`[${onsets.map((o) => mininotationSafe(o.symbol)).join(' ')}]`);
        bar += 1;
      }
      oi++;
    } else {
      const restEnd = onsetBars[oi] ?? end;
      const restLen = restEnd - bar;
      tokens.push(restLen > 1 ? `~!${restLen}` : '~');
      bar = restEnd;
    }
  }
  return tokens;
}

export function serializeStrudel(input: ChordProInput): string {
  const byBar = onsetsByBar(input.chords);
  const beatsPerBar = input.meter_num;

  const usedDefaultTempo = input.tempo_bpm == null;
  const tempo = input.tempo_bpm ?? DEFAULT_TEMPO_BPM;
  const cpm = round3(cyclesPerMinute(tempo, input.meter_num, input.meter_den));

  const out: string[] = [];
  out.push(`// "${input.title}" — exported from Songsmith`);
  const meta = [
    input.song_key ? `key: ${input.song_key}` : null,
    `time: ${input.meter_num}/${input.meter_den}`,
    `tempo: ${tempo} bpm${usedDefaultTempo ? ' (default — song has no tempo set)' : ''}`,
  ].filter((x): x is string => x !== null);
  out.push(`// ${meta.join('   ')}`);
  out.push('//');
  out.push('// Basic export: one step per bar. A chord held across several bars renders');
  out.push('// once with "!n" (e.g. Cm!4); a gap with no chord placed renders as "~"/"~!n".');
  out.push('// A bar with more than one chord nests them in [...], evenly spaced — their');
  out.push('// exact beat position is not preserved. Adjust freely from here.');
  out.push('');
  out.push(`setcpm(${cpm}) // 1 cycle = 1 bar`);
  out.push('');

  const arrangeArgs: string[] = [];
  const seenNames = new Map<string, number>();
  let bar = 1;
  input.sections.forEach((s) => {
    const count = s.bar_count ?? 0;
    if (count <= 0) return;
    const tokens = barTokens(byBar, bar, count, beatsPerBar);
    const varName = uniqueSlug(s.name, seenNames);
    out.push(`// ${s.name} (bar${count > 1 ? 's' : ''} ${bar}${count > 1 ? `-${bar + count - 1}` : ''})`);
    for (const line of s.lines) {
      if (line.text.trim().length > 0) out.push(`// ${line.text}`);
    }
    out.push(`const ${varName} = chord("<${tokens.join(' ')}>").voicing()`);
    out.push('');
    arrangeArgs.push(`  [${count}, ${varName}]`);
    bar += count;
  });

  // bar_count is user-set and can undercount the song's actual length (e.g. a
  // trailing instrumental bar the section length was never updated for) —
  // rather than silently drop those chords, fold them into one extra step.
  const maxChordBar = byBar.size > 0 ? Math.max(...byBar.keys()) : 0;
  if (maxChordBar >= bar) {
    const count = maxChordBar - bar + 1;
    const tokens = barTokens(byBar, bar, count, beatsPerBar);
    const varName = 'unassigned_trailing_bars';
    out.push(`// unassigned trailing bars ${bar}-${maxChordBar} (past every section's bar_count)`);
    out.push(`const ${varName} = chord("<${tokens.join(' ')}>").voicing()`);
    out.push('');
    arrangeArgs.push(`  [${count}, ${varName}]`);
  }

  if (arrangeArgs.length > 0) {
    out.push('arrange(');
    out.push(arrangeArgs.join(',\n'));
    out.push(').sound("piano")');
  } else {
    out.push('// no section had a bar count set, and no chords were placed — nothing to arrange');
  }

  return out.join('\n') + '\n';
}
