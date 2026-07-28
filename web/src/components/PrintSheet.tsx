import type { Grid, Song, WordProsody } from '../api';
import { displaySymbol } from '../nashville';

/**
 * Syllable ordinal -> character span within its line's raw text. Same
 * algorithm as the server's src/export/chordpro.ts (locate each word by
 * `indexOf` from an advancing cursor, then walk its syllable chunks) — kept
 * as a small client-side copy since it's a generic string match with no
 * business logic to drift, and this is the only place on the client that
 * needs it.
 */
function syllableSpans(text: string, words: WordProsody[]): { index: number; start: number; end: number }[] {
  const spans: { index: number; start: number; end: number }[] = [];
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

/** A monospace chord row aligned above the lyric row by character column. */
function chordRowFor(text: string, words: WordProsody[], chordsByIndex: Map<number, string>): string {
  if (chordsByIndex.size === 0) return '';
  const spans = syllableSpans(text, words);
  let row = '';
  for (const span of spans) {
    const chord = chordsByIndex.get(span.index);
    if (!chord) continue;
    row = row.length < span.start ? row.padEnd(span.start, ' ') + chord : row + chord;
  }
  return row;
}

/**
 * Print-only leadsheet: title/key at top, chord symbols aligned above the
 * lyric they land on, no rails/inspector/buttons/gutter. Hidden on screen
 * (see .print-sheet in styles.css) and shown only under @media print — a
 * dedicated view rather than CSS-hiding pieces of the editor, since the
 * editor's DOM (textareas, drag handles, the per-active-line-only chord
 * segmentation) isn't what a printed page wants.
 */
export function PrintSheet({ song, grid }: { song: Song; grid: Grid | null }) {
  const chordDisplay = song.chord_display;
  const songKey = song.song_key;
  let barOffset = 0;
  const ranges = song.sections.map((s) => {
    const start = barOffset + 1;
    barOffset += s.bar_count ?? 0;
    return { start, end: barOffset + 1 };
  });

  return (
    <div className="print-sheet" aria-hidden="true">
      <header className="print-head">
        <h1>{song.title}</h1>
        <p className="print-meta">
          {song.song_key ? `Key: ${song.song_key}` : null}
          {song.tempo_bpm ? ` · ${song.tempo_bpm} bpm` : null}
          {` · ${song.meter_num}/${song.meter_den}`}
        </p>
      </header>

      {song.sections.map((section, si) => {
        const range = ranges[si]!;
        const isLast = si === song.sections.length - 1;
        const unplaced = (grid?.chords ?? [])
          .filter((c) => c.line_id === null)
          .filter((c) => (c.bar >= range.start && c.bar < range.end) || (isLast && c.bar >= range.end))
          .sort((a, b) => a.bar - b.bar || a.beat - b.beat);

        return (
          <section key={section.id} className="print-sec">
            <h2>{section.name}</h2>
            {section.lines.map((line) => {
              const gridLine = grid?.lines.find((l) => l.line_id === line.id);
              const chordsByIndex = new Map(
                (grid?.chords ?? [])
                  .filter((c) => c.line_id === line.id && c.syllable_index !== null)
                  .map((c) => [c.syllable_index as number, displaySymbol(c.symbol, chordDisplay, songKey)]),
              );
              const chordRow = gridLine ? chordRowFor(line.text, line.syllables, chordsByIndex) : '';
              return (
                <div key={line.id} className="print-line">
                  {chordRow ? <div className="print-chords">{chordRow}</div> : null}
                  <div className="print-lyric">{line.text || ' '}</div>
                </div>
              );
            })}
            {unplaced.length > 0 ? (
              <div className="print-line">
                <div className="print-chords">
                  {unplaced.map((c) => displaySymbol(c.symbol, chordDisplay, songKey)).join('  ')}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
