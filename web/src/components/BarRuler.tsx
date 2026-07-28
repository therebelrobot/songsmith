import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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
  /** Explicit move-earlier/move-later controls in the chord editor popover — the touch path, since drag never fires there. */
  onMoveChord: (id: number, bar: number, beat: number) => void;
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
  onMoveChord,
}: Props) {
  const bars = Array.from({ length: barCount }, (_, i) => startBar + i);
  const [editing, setEditing] = useState<{ bar: number; beat: number; chordId: number | null } | null>(null);

  function chordAt(bar: number, beat: number): PlacedChord | undefined {
    return chords.find((c) => c.bar === bar && Math.round(c.beat) === beat);
  }

  /** Adjacent beat slot, wrapping into the previous/next bar at a bar boundary. Chords key off absolute (bar, beat), not the section, so this can cross a section boundary — that's fine. */
  function movePrev(id: number, bar: number, beat: number) {
    const target = beat > 1 ? { bar, beat: beat - 1 } : bar > 1 ? { bar: bar - 1, beat: meterNum } : null;
    if (!target) return;
    onMoveChord(id, target.bar, target.beat);
    setEditing(null);
  }

  function moveNext(id: number, bar: number, beat: number) {
    const target = beat < meterNum ? { bar, beat: beat + 1 } : { bar: bar + 1, beat: 1 };
    onMoveChord(id, target.bar, target.beat);
    setEditing(null);
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
          // Read by the mobile chord-slot sizing rule (see styles.css) to size
          // each bar for `meterNum` full 44px touch targets rather than
          // compressing them to fit.
          style={{ '--beats': meterNum } as CSSProperties}
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
                const chordId = editing.chordId;
                return (
                  <ChordSlotEditor
                    key={beat}
                    initial={chord ? displaySymbol(chord.symbol, chordDisplay, songKey) : ''}
                    suggestions={diatonicSuggestions}
                    songKey={songKey}
                    onCommit={commit}
                    onCancel={() => setEditing(null)}
                    move={
                      chordId !== null
                        ? { onPrev: () => movePrev(chordId, bar, beat), onNext: () => moveNext(chordId, bar, beat) }
                        : undefined
                    }
                    onDelete={
                      chordId !== null
                        ? () => {
                            onDeleteChord(chordId);
                            setEditing(null);
                          }
                        : undefined
                    }
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
  move,
  onDelete,
}: {
  initial: string;
  suggestions: readonly string[];
  songKey: string | null;
  onCommit: (symbol: string) => void;
  onCancel: () => void;
  /** Present only when editing an existing chord (not while adding a new one) — moves it to the adjacent beat slot. */
  move?: { onPrev: () => void; onNext: () => void };
  /** The chip's own delete "×" only reveals on hover, which doesn't exist on touch — this is the reachable path there (and everywhere else). */
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const trimmed = draft.trim();
  // A letter name always works; a number chart symbol works too, whichever
  // display mode is active — entry format is never gated on it.
  const invalid = trimmed.length > 0 && !isValidChordSymbol(trimmed) && !(songKey && fromNumber(trimmed, songKey));

  // The bar ruler scrolls horizontally (`.ruler { overflow-x: auto }`), which
  // per the CSS overflow spec forces its vertical overflow to clip too —
  // position: absolute would get cut off at the ruler's own bottom edge.
  // Fixed positioning, anchored from a rect read once at mount, escapes that.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 2, left: rect.left });
  }, []);

  return (
    <div className="chord-editor" ref={wrapRef}>
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
      {(invalid || suggestions.length > 0 || move || onDelete) && popoverPos ? (
        <div className="chord-editor-popover" style={{ top: popoverPos.top, left: popoverPos.left }}>
          {invalid ? <span className="chord-error">not a chord tonal recognizes</span> : null}
          {move ? (
            <div className="chord-move-controls">
              <button
                type="button"
                className="ghost move-btn"
                // mousedown fires before the input's blur, so the click survives
                onMouseDown={(e) => {
                  e.preventDefault();
                  move.onPrev();
                }}
              >
                ◀ earlier
              </button>
              <button
                type="button"
                className="ghost move-btn"
                onMouseDown={(e) => {
                  e.preventDefault();
                  move.onNext();
                }}
              >
                later ▶
              </button>
            </div>
          ) : null}
          {onDelete ? (
            <div className="chord-move-controls">
              <button
                type="button"
                className="ghost danger move-btn"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onDelete();
                }}
              >
                Delete chord
              </button>
            </div>
          ) : null}
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
