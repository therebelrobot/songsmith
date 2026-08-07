/**
 * Strudel/Tidal-style export: turns the resolved chord grid into a Strudel
 * (https://strudel.cc) pattern using its tonal-backed `.chord()` mini-notation
 * — the same chord symbols already stored on the song (see
 * src/music/voiceLeading.ts, which resolves them with the same tonal
 * library), so no symbol translation is needed.
 *
 * One Strudel cycle == one bar. A bar holding more than one chord nests them
 * in `[...]`, evenly spaced across the bar — mini-notation has no concept of
 * "beat 2.5", so the exact beat position from the grid isn't preserved. This
 * is a basic, lossy jumping-off point for further editing in Strudel, not a
 * lossless round trip like ChordPro. Each section's lyric lines are dropped
 * in as plain `//` comments above its pattern — reference only, Strudel has
 * no notion of sung lyrics.
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

/** One mini-notation token per bar in [start, start + count): a chord symbol, "~" for a bar with no chord, or "[a b ...]" for a bar with several. */
function barTokens(chordsByBar: Map<number, string[]>, start: number, count: number): string[] {
  const tokens: string[] = [];
  for (let bar = start; bar < start + count; bar++) {
    const symbols = chordsByBar.get(bar);
    if (!symbols || symbols.length === 0) tokens.push('~');
    else if (symbols.length === 1) tokens.push(mininotationSafe(symbols[0]!));
    else tokens.push(`[${symbols.map(mininotationSafe).join(' ')}]`);
  }
  return tokens;
}

export function serializeStrudel(input: ChordProInput): string {
  const chordsByBar = new Map<number, string[]>();
  for (const c of [...input.chords].sort((a, b) => a.bar - b.bar || a.beat - b.beat)) {
    const list = chordsByBar.get(c.bar) ?? [];
    list.push(c.symbol);
    chordsByBar.set(c.bar, list);
  }

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
  out.push('// Basic export: one step per bar. A bar holding more than one chord nests');
  out.push('// them in [...], evenly spaced — their exact beat position is not preserved.');
  out.push('// Bars with no chord render as "~". Adjust freely from here.');
  out.push('');
  out.push(`setcpm(${cpm}) // 1 cycle = 1 bar`);
  out.push('');

  const arrangeArgs: string[] = [];
  const seenNames = new Map<string, number>();
  let bar = 1;
  input.sections.forEach((s) => {
    const count = s.bar_count ?? 0;
    if (count <= 0) return;
    const tokens = barTokens(chordsByBar, bar, count);
    const varName = uniqueSlug(s.name, seenNames);
    out.push(`// ${s.name} (bar${count > 1 ? 's' : ''} ${bar}${count > 1 ? `-${bar + count - 1}` : ''})`);
    for (const line of s.lines) {
      if (line.text.trim().length > 0) out.push(`// ${line.text}`);
    }
    out.push(`const ${varName} = n("0").chord("<${tokens.join(' ')}>").voicing()`);
    out.push('');
    arrangeArgs.push(`  [${count}, ${varName}]`);
    bar += count;
  });

  // bar_count is user-set and can undercount the song's actual length (e.g. a
  // trailing instrumental bar the section length was never updated for) —
  // rather than silently drop those chords, fold them into one extra step.
  const maxChordBar = chordsByBar.size > 0 ? Math.max(...chordsByBar.keys()) : 0;
  if (maxChordBar >= bar) {
    const count = maxChordBar - bar + 1;
    const tokens = barTokens(chordsByBar, bar, count);
    const varName = 'unassigned_trailing_bars';
    out.push(`// unassigned trailing bars ${bar}-${maxChordBar} (past every section's bar_count)`);
    out.push(`const ${varName} = n("0").chord("<${tokens.join(' ')}>").voicing()`);
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
