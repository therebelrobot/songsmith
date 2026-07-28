import { useEffect, useRef } from 'react';
import type { Grid, SyllableAnchor, Song } from '../api';
import { offsetOf } from '../api';
import type { PendingFocus } from '../focus';
import { LineRow } from './LineRow';
import { BarRuler } from './BarRuler';

interface Props {
  song: Song;
  grid: Grid | null;
  activeLineId: number | null;
  /** [lineId, syllableIndex] of the syllable currently sounding, during playback */
  livePosition: readonly [number, number] | null;
  playheadBar: number | null;
  diatonicSuggestions: readonly string[];
  /** Set by a useSong mutation to say what should self-focus once it exists in the DOM; cleared once it does. */
  pendingFocus: PendingFocus;
  onFocusHandled: () => void;
  onSelectLine: (id: number) => void;
  onEditLine: (id: number, text: string) => void;
  onAddLine: (sectionId: number, afterId?: number) => void;
  onDeleteLine: (id: number) => void;
  onMoveLine: (id: number, beforeId: number) => void;
  onMoveLineUp: (id: number) => void;
  onMoveLineDown: (id: number) => void;
  onRenameSection: (id: number, name: string) => void;
  onSectionBarCount: (id: number, barCount: number | null) => void;
  onAddSection: (afterId?: number) => void;
  onDeleteSection: (id: number) => void;
  onAssignLineToBar: (lineId: number, bar: number) => void;
  onSetLineBarBeat: (lineId: number, startBar: number, startBeat: number) => void;
  onToggleAnchor: (lineId: number, index: number) => void;
  onClearTiming: (lineId: number) => void;
  onAddChord: (bar: number, beat: number, symbol: string) => void;
  onMoveChord: (id: number, bar: number, beat: number) => void;
  onRenameChord: (id: number, symbol: string) => void;
  onDeleteChord: (id: number) => void;
}

export function Sheet({
  song,
  grid,
  activeLineId,
  livePosition,
  playheadBar,
  diatonicSuggestions,
  pendingFocus,
  onFocusHandled,
  onSelectLine,
  onEditLine,
  onAddLine,
  onDeleteLine,
  onMoveLine,
  onMoveLineUp,
  onMoveLineDown,
  onRenameSection,
  onSectionBarCount,
  onAddSection,
  onDeleteSection,
  onAssignLineToBar,
  onSetLineBarBeat,
  onToggleAnchor,
  onClearTiming,
  onAddChord,
  onMoveChord,
  onRenameChord,
  onDeleteChord,
}: Props) {
  const dragged = useRef<number | null>(null);
  const draggedChord = useRef<number | null>(null);
  const beatsPerBar = song.meter_num;

  // Bars are a single timeline across the whole song: each section occupies
  // the bars right after the one before it, in order. A section with no
  // bar_count yet contributes nothing to that offset.
  let barOffset = 0;

  return (
    <div className="sheet">
      <p className="shortcut-hint">
        <kbd>Enter</kbd> new line · <kbd>Shift</kbd>+<kbd>Enter</kbd> line break · <kbd>Backspace</kbd> in an empty
        line deletes it
      </p>

      {song.sections.map((section) => {
        const sectionStartBar = barOffset + 1;
        barOffset += section.bar_count ?? 0;

        return (
          <section key={section.id} className="sec">
            <header className="sec-head">
              <SectionNameInput
                name={section.name}
                shouldFocus={pendingFocus?.kind === 'section' && pendingFocus.id === section.id}
                onFocused={onFocusHandled}
                onChange={(name) => onRenameSection(section.id, name)}
              />
              <label className="sec-bars">
                <span>bars</span>
                <input
                  type="number"
                  min={0}
                  max={2048}
                  className="bar-count-input"
                  value={section.bar_count ?? ''}
                  placeholder="—"
                  aria-label="Bar count"
                  onChange={(e) =>
                    onSectionBarCount(section.id, e.target.value ? Number(e.target.value) : null)
                  }
                />
              </label>
              <span className="sec-meta">
                {section.lines.reduce((a, l) => a + l.syllable_count, 0)} syl ·{' '}
                {section.lines.length} {section.lines.length === 1 ? 'line' : 'lines'}
              </span>
              <button className="ghost" onClick={() => onAddSection(section.id)}>
                Add section below
              </button>
              <button
                className="ghost danger"
                onClick={() => onDeleteSection(section.id)}
                title="Deletes the section and its lines. Snapshot first if you want it back."
              >
                Delete section
              </button>
            </header>

            {section.bar_count ? (
              <BarRuler
                startBar={sectionStartBar}
                barCount={section.bar_count}
                meterNum={beatsPerBar}
                playheadBar={playheadBar}
                onDropBar={(bar) => {
                  const from = dragged.current;
                  if (from !== null) onAssignLineToBar(from, bar);
                }}
                chords={
                  grid?.chords.filter(
                    (c) => c.bar >= sectionStartBar && c.bar < sectionStartBar + (section.bar_count ?? 0),
                  ) ?? []
                }
                diatonicSuggestions={diatonicSuggestions}
                chordDisplay={song.chord_display}
                songKey={song.song_key}
                onAddChord={onAddChord}
                onRenameChord={onRenameChord}
                onDeleteChord={onDeleteChord}
                onDragStartChord={(id) => {
                  draggedChord.current = id;
                }}
                onDropChordSlot={(bar, beat) => {
                  const id = draggedChord.current;
                  draggedChord.current = null;
                  if (id !== null) onMoveChord(id, bar, beat);
                }}
                onMoveChord={onMoveChord}
              />
            ) : (
              <p className="ruler-empty">
                No bars set, so there's nowhere for chords to go yet.{' '}
                <button className="link" onClick={() => onSectionBarCount(section.id, 8)}>
                  Set 8 bars
                </button>{' '}
                to enable the chord track.
              </p>
            )}

            {section.lines.length === 0 ? (
              <p className="empty">
                Nothing here yet.{' '}
                <button className="link" onClick={() => onAddLine(section.id)}>
                  Write the first line
                </button>
                .
              </p>
            ) : (
              <ol className="lines">
                {section.lines.map((line, i) => {
                  const gridLine = grid?.lines.find((l) => l.line_id === line.id);
                  const liveIndex =
                    livePosition && livePosition[0] === line.id ? livePosition[1] : null;
                  const lineChords = grid?.chords.filter((c) => c.line_id === line.id) ?? [];
                  return (
                    <LineRow
                      key={line.id}
                      line={line}
                      active={line.id === activeLineId}
                      gridLine={gridLine}
                      liveIndex={liveIndex}
                      chords={lineChords}
                      chordDisplay={song.chord_display}
                      songKey={song.song_key}
                      shouldFocus={pendingFocus?.kind === 'line' && pendingFocus.id === line.id}
                      onFocused={onFocusHandled}
                      onFocus={() => onSelectLine(line.id)}
                      onChange={(text) => onEditLine(line.id, text)}
                      onSplitBelow={() => onAddLine(section.id, line.id)}
                      onDelete={() => onDeleteLine(line.id)}
                      onDragStart={() => {
                        dragged.current = line.id;
                      }}
                      onDropOn={() => {
                        const from = dragged.current;
                        dragged.current = null;
                        if (from !== null && from !== line.id) onMoveLine(from, line.id);
                      }}
                      onSetBarBeat={(startBar, startBeat) =>
                        onSetLineBarBeat(line.id, startBar, startBeat)
                      }
                      onToggleAnchor={(index) => onToggleAnchor(line.id, index)}
                      onClearTiming={() => onClearTiming(line.id)}
                      canMoveUp={i > 0}
                      canMoveDown={i < section.lines.length - 1}
                      onMoveUp={() => onMoveLineUp(line.id)}
                      onMoveDown={() => onMoveLineDown(line.id)}
                    />
                  );
                })}
              </ol>
            )}

            <button className="ghost add-line" onClick={() => onAddLine(section.id)}>
              Add line
            </button>
          </section>
        );
      })}

      <button className="ghost add-section" onClick={() => onAddSection()}>
        Add section
      </button>
    </div>
  );
}

/** The section name field, self-focusing (no caret placement needed — it's short and usually replaced wholesale) when `shouldFocus` flips true after "Add section". */
function SectionNameInput({
  name,
  shouldFocus,
  onFocused,
  onChange,
}: {
  name: string;
  shouldFocus: boolean;
  onFocused: () => void;
  onChange: (name: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shouldFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    onFocused();
  }, [shouldFocus, onFocused]);

  return (
    <input
      ref={ref}
      className="sec-name"
      value={name}
      aria-label="Section name"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Reconstruct a line's full anchor list from its resolved grid entry (pinned syllables only). */
export function anchorsOf(gridLine: { start_bar: number; start_beat: number; syllables: { index: number; bar: number; beat: number; pinned: boolean }[] } | undefined, beatsPerBar: number): SyllableAnchor[] {
  if (!gridLine) return [];
  return gridLine.syllables
    .filter((s) => s.pinned)
    .map((s) => ({ index: s.index, offset: Math.round(offsetOf(gridLine, beatsPerBar, s)) }));
}
