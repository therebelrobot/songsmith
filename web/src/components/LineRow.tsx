import { useEffect, useRef, useState } from 'react';
import type { GridLine, Line, PlacedChord } from '../api';
import { displaySymbol } from '../nashville';
import { StressLine, Segmentation, scansionLabel } from './Scansion';

interface Props {
  line: Line;
  active: boolean;
  gridLine?: GridLine;
  liveIndex?: number | null;
  chords: PlacedChord[];
  chordDisplay: string;
  songKey: string | null;
  /** True for exactly one render after a mutation targets this line; the line focuses itself, caret at the end, then calls onFocused. */
  shouldFocus: boolean;
  onFocused: () => void;
  onFocus: () => void;
  onChange: (text: string) => void;
  onSplitBelow: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
  onToggleAnchor: (index: number) => void;
  onSetBarBeat: (startBar: number, startBeat: number) => void;
  onClearTiming: () => void;
  /** Explicit reorder controls — the only way to reorder on touch, since HTML5 drag never fires there; also a better-targeted path than drag on desktop. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function LineRow({
  line,
  active,
  gridLine,
  liveIndex,
  chords,
  chordDisplay,
  songKey,
  shouldFocus,
  onFocused,
  onFocus,
  onChange,
  onSplitBelow,
  onDelete,
  onDragStart,
  onDropOn,
  onToggleAnchor,
  onSetBarBeat,
  onClearTiming,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: Props) {
  const [draft, setDraft] = useState(line.text);
  const [over, setOver] = useState(false);
  const [scanExpanded, setScanExpanded] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Adopt server text only when this line is not the one being typed in,
  // otherwise an in-flight autosave response would yank the cursor.
  useEffect(() => {
    if (!active) setDraft(line.text);
  }, [line.text, active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // Fires post-render, once the textarea actually exists in the DOM — a
  // ref.focus() called right after the mutation's await would run before
  // that, since reload()'s re-render hasn't happened yet.
  useEffect(() => {
    if (!shouldFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    onFocused();
  }, [shouldFocus, onFocused]);

  const estimated = line.syllables.some((w) => !w.known);
  const pinned = gridLine ? new Set(gridLine.syllables.filter((s) => s.pinned).map((s) => s.index)) : undefined;
  const chordsByIndex = new Map(
    chords
      .filter((c) => c.syllable_index !== null)
      .map((c) => [c.syllable_index as number, displaySymbol(c.symbol, chordDisplay, songKey)]),
  );

  return (
    <li
      className={`line${active ? ' line-active' : ''}${over ? ' line-over' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropOn();
      }}
    >
      <div
        className="gutter"
        title={scansionLabel(line.syllables)}
        role="button"
        tabIndex={0}
        aria-label={scanExpanded ? 'Hide stress sparkline' : 'Show stress sparkline'}
        onClick={() => setScanExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setScanExpanded((v) => !v);
          }
        }}
      >
        <span className={estimated ? 'count count-guess' : 'count'}>{line.syllable_count}</span>
        <span className="gutter-scan">
          <StressLine words={line.syllables} />
        </span>
      </div>
      {scanExpanded ? (
        <div className="gutter-scan-below">
          <StressLine words={line.syllables} />
        </div>
      ) : null}

      <div className="line-body">
        <textarea
          ref={ref}
          className="line-input"
          rows={1}
          value={draft}
          placeholder="…"
          spellCheck
          onFocus={onFocus}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSplitBelow();
            }
            if (e.key === 'Backspace' && draft === '') {
              e.preventDefault();
              onDelete();
            }
          }}
        />
        {active ? (
          <Segmentation
            words={line.syllables}
            pinned={pinned}
            liveIndex={liveIndex}
            chordsByIndex={chordsByIndex}
            onToggleAnchor={onToggleAnchor}
          />
        ) : null}
        {active ? (
          <div className="timing-row">
            <label className="timing-field">
              <span>bar</span>
              <input
                type="number"
                min={1}
                className="bar-input"
                value={gridLine?.start_bar ?? ''}
                placeholder="—"
                aria-label="Start bar"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1) onSetBarBeat(v, gridLine?.start_beat ?? 1);
                }}
              />
            </label>
            <label className="timing-field">
              <span>beat</span>
              <input
                type="number"
                min={1}
                step={0.25}
                className="beat-input"
                value={gridLine?.start_beat ?? ''}
                placeholder="—"
                aria-label="Start beat"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1) onSetBarBeat(gridLine?.start_bar ?? 1, v);
                }}
              />
            </label>
            {gridLine ? (
              <button className="ghost" onClick={onClearTiming}>
                Unplace
              </button>
            ) : (
              <span className="hint">drag onto the bar ruler, or pin a syllable</span>
            )}
          </div>
        ) : null}
      </div>

      <span
        className={line.rhyme_label ? 'tab' : 'tab tab-none'}
        title={line.rhyme_key ? `rhymes on ${line.rhyme_key}` : 'last word not in dictionary'}
      >
        {line.rhyme_label ?? '·'}
      </span>

      {line.alternates.length > 0 ? (
        <span className="alt-count" title={`${line.alternates.length} stashed`}>
          {line.alternates.length}
        </span>
      ) : null}

      <div className="reorder">
        <button
          type="button"
          className="reorder-btn"
          aria-label="Move line up"
          disabled={!canMoveUp}
          onClick={onMoveUp}
        >
          ▲
        </button>
        <button
          type="button"
          className="reorder-btn"
          aria-label="Move line down"
          disabled={!canMoveDown}
          onClick={onMoveDown}
        >
          ▼
        </button>
      </div>
    </li>
  );
}
