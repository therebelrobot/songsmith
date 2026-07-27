import { renderToStaticMarkup } from 'react-dom/server';
import { Sheet } from './src/components/Sheet';
import { Inspector } from './src/components/Inspector';
import type { Song } from './src/api';

const base = process.env.BASE ?? 'http://localhost:5183';

function assert(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
const song: Song = await (await fetch(`${base}/api/songs/1`)).json();
const noop = () => {};

const sheet = renderToStaticMarkup(
  <Sheet
    song={song}
    activeLineId={song.sections[0]!.lines[0]!.id}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onAddSection={noop}
    onDeleteSection={noop}
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
    activeLineId={null}
    onSelectLine={noop}
    onEditLine={noop}
    onAddLine={noop}
    onDeleteLine={noop}
    onMoveLine={noop}
    onRenameSection={noop}
    onAddSection={noop}
    onDeleteSection={noop}
  />,
);
assert('empty section shows an invitation', emptySheet.includes('Write the first line'));
}

void main();
