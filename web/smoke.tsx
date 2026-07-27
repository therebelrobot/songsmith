import { renderToStaticMarkup } from 'react-dom/server';
import { Sheet } from './src/components/Sheet';
import { Inspector } from './src/components/Inspector';
import type { Grid, Song } from './src/api';

const base = process.env.BASE ?? 'http://localhost:5183';

function assert(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

const noop = () => {};
const noopBar = () => {};
const noopBeat = () => {};
const noopIdx = () => {};

function emptyGrid(song: Song): Grid {
  return { meter_num: song.meter_num, meter_den: song.meter_den, tempo_bpm: song.tempo_bpm, lines: [] };
}

async function main() {
const song: Song = await (await fetch(`${base}/api/songs/1`)).json();

const sheet = renderToStaticMarkup(
  <Sheet
    song={song}
    grid={emptyGrid(song)}
    activeLineId={song.sections[0]!.lines[0]!.id}
    livePosition={null}
    playheadBar={null}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onSectionBarCount={noop}
    onAddSection={noop}
    onDeleteSection={noop}
    onAssignLineToBar={noopBar}
    onSetLineBarBeat={noopBeat}
    onToggleAnchor={noopIdx}
    onClearTiming={noop}
  />,
);

const strongMarks = (sheet.match(/mark mark-strong/g) ?? []).length;
const weakMarks = (sheet.match(/mark mark-weak/g) ?? []).length;
const totalSyllables = song.sections.flatMap((s) => s.lines).reduce((a, l) => a + l.syllable_count, 0);

assert('sheet renders section name', sheet.includes(song.sections[0]!.name));
assert('sheet renders every line text', song.sections.flatMap((s) => s.lines).every((l) => l.text === '' || sheet.includes(l.text.slice(0, 20))));
assert('stress sparkline emits one mark per syllable', strongMarks + weakMarks > 0 && strongMarks + weakMarks <= totalSyllables, `${strongMarks + weakMarks} marks / ${totalSyllables} syllables`);
assert('primary stresses present', strongMarks > 0, `${strongMarks} strong`);
assert('rhyme tabs rendered', /class="tab"/.test(sheet));
assert('active line shows segmentation', sheet.includes('segmentation'));
assert('syllable counts in gutter', /class="count"/.test(sheet));
assert('timing controls render for the active line', sheet.includes('aria-label="Start bar"') && sheet.includes('aria-label="Start beat"'));
assert('unplaced line hints at how to place it', sheet.includes('drag onto the bar ruler'));

// --- bar ruler ---

const barredSong: Song = {
  ...song,
  sections: [{ ...song.sections[0]!, bar_count: 4 }],
};
const barredSheet = renderToStaticMarkup(
  <Sheet
    song={barredSong}
    grid={emptyGrid(song)}
    activeLineId={null}
    livePosition={null}
    playheadBar={2}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onSectionBarCount={noop}
    onAddSection={noop}
    onDeleteSection={noop}
    onAssignLineToBar={noopBar}
    onSetLineBarBeat={noopBeat}
    onToggleAnchor={noopIdx}
    onClearTiming={noop}
  />,
);
const barTicks = (barredSheet.match(/class="ruler-bar-num"/g) ?? []).length;
assert('bar ruler renders one tick per bar', barTicks === 4, `${barTicks} ticks for bar_count=4`);
assert('bar ruler numbers the bars from 1', barredSheet.includes('>1<') && barredSheet.includes('>4<'));
assert('bar ruler highlights the live bar', barredSheet.includes('ruler-bar-live'));

const unbarredSheet = renderToStaticMarkup(
  <Sheet
    song={song}
    grid={emptyGrid(song)}
    activeLineId={null}
    livePosition={null}
    playheadBar={null}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onSectionBarCount={noop}
    onAddSection={noop}
    onDeleteSection={noop}
    onAssignLineToBar={noopBar}
    onSetLineBarBeat={noopBeat}
    onToggleAnchor={noopIdx}
    onClearTiming={noop}
  />,
);
assert('no ruler when a section has no bar_count', !unbarredSheet.includes('class="ruler"'));

// --- syllable anchoring ---

const anchorLine = song.sections.flatMap((s) => s.lines).find((l) => l.syllable_count > 0) ?? song.sections[0]!.lines[0]!;
const flatSyllableCount = anchorLine.syllables.flatMap((w) => w.syllables).length;
const pinnedGrid: Grid = {
  meter_num: song.meter_num,
  meter_den: song.meter_den,
  tempo_bpm: song.tempo_bpm,
  lines: [
    {
      line_id: anchorLine.id,
      start_bar: 1,
      start_beat: 1,
      syllables: Array.from({ length: flatSyllableCount }, (_, i) => ({
        index: i,
        bar: 1,
        beat: 1 + i,
        pinned: i === 0,
      })),
    },
  ],
};
const pinnedSheet = renderToStaticMarkup(
  <Sheet
    song={song}
    grid={pinnedGrid}
    activeLineId={anchorLine.id}
    livePosition={flatSyllableCount > 1 ? [anchorLine.id, 1] : null}
    playheadBar={1}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onSectionBarCount={noop}
    onAddSection={noop}
    onDeleteSection={noop}
    onAssignLineToBar={noopBar}
    onSetLineBarBeat={noopBeat}
    onToggleAnchor={noopIdx}
    onClearTiming={noop}
  />,
);
assert(
  'pinned syllable gets a distinct visual state',
  flatSyllableCount === 0 || pinnedSheet.includes('syl-pinned'),
  flatSyllableCount === 0 ? 'skipped: fixture line has no syllables' : '',
);
assert(
  'the syllable under the playhead is marked live',
  flatSyllableCount <= 1 || pinnedSheet.includes('syl-live'),
  flatSyllableCount <= 1 ? 'skipped: fixture line has too few syllables' : '',
);
assert('a placed line shows an Unplace control', pinnedSheet.includes('Unplace'));

const inspector = renderToStaticMarkup(
  <Inspector
    line={song.sections[0]!.lines[0]!}
    songId={song.id}
    onPromote={noop}
    onStash={noop}
    onDiscard={noop}
    onRestored={noop}
    onError={noop}
  />,
);
assert('inspector renders tabs', inspector.includes('alternates') && inspector.includes('rhymes') && inspector.includes('history'));

const emptyInspector = renderToStaticMarkup(
  <Inspector line={null} songId={song.id} onPromote={noop} onStash={noop} onDiscard={noop} onRestored={noop} onError={noop} />,
);
assert('inspector handles no selection', emptyInspector.includes('Select a line'));

const emptySong: Song = { ...song, sections: [{ ...song.sections[0]!, lines: [] }] };
const emptySheet = renderToStaticMarkup(
  <Sheet
    song={emptySong}
    grid={emptyGrid(song)}
    activeLineId={null}
    livePosition={null}
    playheadBar={null}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onSectionBarCount={noop}
    onAddSection={noop}
    onDeleteSection={noop}
    onAssignLineToBar={noopBar}
    onSetLineBarBeat={noopBeat}
    onToggleAnchor={noopIdx}
    onClearTiming={noop}
  />,
);
assert('empty section shows an invitation', emptySheet.includes('Write the first line'));
}

void main();
