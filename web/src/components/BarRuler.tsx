import { useState } from 'react';
import type { PlacedChord } from '../api';
import { isValidChordSymbol } from '../chords';
import { displaySymbol, fromNumber } from '../nashville';

interface Props {
  /** absolute bar number of this section's first bar, across the whole song */
  startBar: number;
  barCount: number;
  meterNum: number;
  /** absolute bar currently sounding, if this section is where playback is */
  playheadBar?: number | null;
  onDropBar?: (bar: number) => void;
  /** chords whose bar falls within this section's range */
  chords: PlacedChord[];
  /** diatonic suggestion chips shown while adding a chord; [] when the song has no key */
  diatonicSuggestions: readonly string[];
  /** 'names' or 'numbers' — how chord chips render; entry accepts either format regardless */
  chordDisplay: string;
  songKey: string | null;
  onAddChord: (bar: number, beat: number, symbol: string) => void;
  onRenameChord: (id: number, symbol: string) => void;
  onDeleteChord: (id: number) => void;
  onDragStartChord: (id: number) => void;
  onDropChordSlot: (bar: number, beat: number) => void;
}

/**
 * One tick per bar, one mark per beat inside it, plus the chord track: a slot
 * per beat where a chord can be added, dragged to move, or deleted. Sized
 * from the section's bar_count and meter — no pixel-per-tick timeline.
 */
export function BarRuler({
  startBar,
  barCount,
  meterNum,
  playheadBar,
  onDropBar,
  chords,
  diatonicSuggestions,
  chordDisplay,
  songKey,
  onAddChord,
  onRenameChord,
  onDeleteChord,
  onDragStartChord,
  onDropChordSlot,
}: Props) {
  const bars = Array.from({ length: barCount }, (_, i) => startBar + i);
  const [editing, setEditing] = useState<{ bar: number; beat: number; chordId: number | null } | null>(null);

  function chordAt(bar: number, beat: number): PlacedChord | undefined {
    return chords.find((c) => c.bar === bar && Math.round(c.beat) === beat);
  }

  /** A letter name always works; a number chart symbol works too, whichever mode is showing. */
  function resolveEntry(draft: string): string | null {
    const trimmed = draft.trim();
    if (isValidChordSymbol(trimmed)) return trimmed;
    if (songKey) {
      const fromChart = fromNumber(trimmed, songKey);
      if (fromChart) return fromChart;
    }
    return null;
  }

  function commit(symbol: string) {
    if (!editing) return;
    const resolved = resolveEntry(symbol);
    if (!resolved) return;
    if (editing.chordId !== null) onRenameChord(editing.chordId, resolved);
    else onAddChord(editing.bar, editing.beat, resolved);
    setEditing(null);
  }

  return (
    <div className="ruler" role="list" aria-label={`${barCount} bars`}>
      {bars.map((bar) => (
        <div
          key={bar}
          role="listitem"
          className={bar === playheadBar ? 'ruler-bar ruler-bar-live' : 'ruler-bar'}
          onDragOver={onDropBar ? (e) => e.preventDefault() : undefined}
          onDrop={onDropBar ? () => onDropBar(bar) : undefined}
        >
          <span className="ruler-bar-num">{bar}</span>
          <span className="ruler-beats" aria-hidden="true">
            {Array.from({ length: meterNum }, (_, i) => (
              <i key={i} className="ruler-beat" />
            ))}
          </span>
          <div className="chord-track">
            {Array.from({ length: meterNum }, (_, i) => i + 1).map((beat) => {
              const chord = chordAt(bar, beat);
              const isEditing = editing?.bar === bar && editing?.beat === beat;

              if (isEditing) {
                return (
                  <ChordSlotEditor
                    key={beat}
                    initial={chord ? displaySymbol(chord.symbol, chordDisplay, songKey) : ''}
                    suggestions={diatonicSuggestions}
                    songKey={songKey}
                    onCommit={commit}
                    onCancel={() => setEditing(null)}
                  />
                );
              }

              if (chord) {
                const label = displaySymbol(chord.symbol, chordDisplay, songKey);
                return (
                  <button
                    key={beat}
                    type="button"
                    className="chord-chip"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      onDragStartChord(chord.id);
                    }}
                    onClick={() => setEditing({ bar, beat, chordId: chord.id })}
                    title={`${chord.symbol} — click to rename, drag to move`}
                  >
                    {label}
                    <span
                      className="chord-chip-del"
                      role="button"
                      tabIndex={0}
                      aria-label={`Delete ${chord.symbol}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChord(chord.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onDeleteChord(chord.id);
                        }
                      }}
                    >
                      ×
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={beat}
                  type="button"
                  className="chord-slot"
                  aria-label={`Add chord at bar ${bar} beat ${beat}`}
                  onClick={() => setEditing({ bar, beat, chordId: null })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.stopPropagation();
                    onDropChordSlot(bar, beat);
                  }}
                >
                  +
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChordSlotEditor({
  initial,
  suggestions,
  songKey,
  onCommit,
  onCancel,
}: {
  initial: string;
  suggestions: readonly string[];
  songKey: string | null;
  onCommit: (symbol: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const trimmed = draft.trim();
  // A letter name always works; a number chart symbol works too, whichever
  // display mode is active — entry format is never gated on it.
  const invalid = trimmed.length > 0 && !isValidChordSymbol(trimmed) && !(songKey && fromNumber(trimmed, songKey));

  return (
    <div className="chord-editor">
      <input
        className={invalid ? 'chord-input chord-input-invalid' : 'chord-input'}
        value={draft}
        autoFocus
        placeholder="Am7"
        aria-label="Chord symbol"
        aria-invalid={invalid}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(draft);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {invalid || suggestions.length > 0 ? (
        <div className="chord-editor-popover">
          {invalid ? <span className="chord-error">not a chord tonal recognizes</span> : null}
          {suggestions.length > 0 ? (
            <div className="chord-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chord-chip-suggest"
                  // mousedown fires before the input's blur, so the click survives
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onCommit(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
