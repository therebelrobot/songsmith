import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  getToken,
  offsetOf,
  setToken,
  type Grid,
  type GridLine,
  type Song,
  type SongStub,
  type SyllableAnchor,
} from './api';
import { diatonicChordsForKey, transposeChordSymbol } from './chords';
import { Sheet, anchorsOf } from './components/Sheet';
import { Inspector } from './components/Inspector';
import { TempoControl } from './components/TempoControl';
import { Transport } from './components/Transport';
import { TransposeControl } from './components/TransposeControl';
import { ExportControls } from './components/ExportControls';
import { PrintSheet } from './components/PrintSheet';

/** Which of a line's syllables is under the playhead right now, if any. */
function landingSyllable(gridLine: GridLine | undefined, bar: number, beat: number): number | null {
  if (!gridLine) return null;
  const TOLERANCE_BEATS = 0.13; // just over half a sixteenth note, the metronome's tick grain
  let best: { index: number; dist: number } | null = null;
  for (const s of gridLine.syllables) {
    if (s.bar !== bar) continue;
    const dist = Math.abs(s.beat - beat);
    if (dist <= TOLERANCE_BEATS && (!best || dist < best.dist)) best = { index: s.index, dist };
  }
  return best?.index ?? null;
}

export default function App() {
  const [songs, setSongs] = useState<SongStub[]>([]);
  const [song, setSong] = useState<Song | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [activeLineId, setActiveLineId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playheadBar, setPlayheadBar] = useState<number | null>(null);
  const [livePosition, setLivePosition] = useState<readonly [number, number] | null>(null);

  const timers = useRef(new Map<number, number>());
  const activeLine = song?.sections.flatMap((s) => s.lines).find((l) => l.id === activeLineId) ?? null;
  const diatonicSuggestions = useMemo(() => diatonicChordsForKey(song?.song_key ?? null), [song?.song_key]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setNeedsToken(true);
        setError('That token was rejected.');
        return;
      }
      setError(err instanceof Error ? err.message : 'something went wrong');
    }
  }, []);

  const refreshList = useCallback(
    () => guard(async () => setSongs(await api.listSongs())),
    [guard],
  );

  const reload = useCallback(
    (id: number) =>
      guard(async () => {
        const [s, g] = await Promise.all([api.getSong(id), api.getGrid(id)]);
        setSong(s);
        setGrid(g);
      }),
    [guard],
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  function patchTempo(patch: { tempo_bpm?: number | null; meter_num?: number; meter_den?: number }) {
    if (!song) return;
    setSong({ ...song, ...patch });
    void guard(async () => {
      await api.patchSong(song.id, patch);
      // meter changes the bar/beat every syllable resolves to, so refresh the grid too.
      await reload(song.id);
    });
  }

  function onSectionBarCount(id: number, barCount: number | null) {
    if (!song) return;
    setSong({
      ...song,
      sections: song.sections.map((s) => (s.id === id ? { ...s, bar_count: barCount } : s)),
    });
    void guard(async () => {
      await api.patchSection(id, { bar_count: barCount });
    });
  }

  function onAssignLineToBar(lineId: number, bar: number) {
    if (!song) return;
    const gridLine = grid?.lines.find((l) => l.line_id === lineId);
    const startBeat = gridLine?.start_beat ?? 1;
    const syllableOffsets = anchorsOf(gridLine, song.meter_num);
    void guard(async () => {
      await api.putLineTiming(lineId, { start_bar: bar, start_beat: startBeat, syllable_offsets: syllableOffsets });
      await reload(song.id);
    });
  }

  function onSetLineBarBeat(lineId: number, startBar: number, startBeat: number) {
    if (!song) return;
    const gridLine = grid?.lines.find((l) => l.line_id === lineId);
    const syllableOffsets = anchorsOf(gridLine, song.meter_num);
    void guard(async () => {
      await api.putLineTiming(lineId, { start_bar: startBar, start_beat: startBeat, syllable_offsets: syllableOffsets });
      await reload(song.id);
    });
  }

  /** Click a syllable to pin it at its current beat, or unpin it if already pinned. */
  function onToggleAnchor(lineId: number, index: number) {
    if (!song) return;
    const beatsPerBar = song.meter_num;
    const gridLine = grid?.lines.find((l) => l.line_id === lineId);
    const startBar = gridLine?.start_bar ?? 1;
    const startBeat = gridLine?.start_beat ?? 1;
    const current = anchorsOf(gridLine, beatsPerBar);
    const already = current.some((a) => a.index === index);
    let next: SyllableAnchor[];
    if (already) {
      next = current.filter((a) => a.index !== index);
    } else {
      const syl = gridLine?.syllables.find((s) => s.index === index);
      // Unplaced line, or a syllable past the last resolved one: fall back to
      // the same one-beat-per-syllable default resolveLineTiming() itself
      // uses when there are no anchors yet.
      const offset = syl && gridLine ? Math.round(offsetOf(gridLine, beatsPerBar, syl)) : index * 4;
      next = [...current, { index, offset }].sort((a, b) => a.index - b.index);
    }
    void guard(async () => {
      await api.putLineTiming(lineId, { start_bar: startBar, start_beat: startBeat, syllable_offsets: next });
      await reload(song.id);
    });
  }

  function onClearTiming(lineId: number) {
    if (!song) return;
    void guard(async () => {
      await api.deleteLineTiming(lineId);
      await reload(song.id);
    });
  }

  function onAddChord(bar: number, beat: number, symbol: string) {
    if (!song) return;
    void guard(async () => {
      await api.addChord(song.id, { bar, beat, symbol });
      await reload(song.id);
    });
  }

  function onMoveChord(id: number, bar: number, beat: number) {
    if (!song) return;
    void guard(async () => {
      await api.moveChord(id, { bar, beat });
      await reload(song.id);
    });
  }

  function onRenameChord(id: number, symbol: string) {
    if (!song) return;
    void guard(async () => {
      await api.patchChord(id, { symbol });
      await reload(song.id);
    });
  }

  function onDeleteChord(id: number) {
    if (!song) return;
    void guard(async () => {
      await api.deleteChord(id);
      await reload(song.id);
    });
  }

  /** Computes the new symbols here (with tonal) and writes the finished result atomically. */
  function onTranspose(semitones: number) {
    if (!song) return;
    const chords = (grid?.chords ?? []).map((c) => ({ id: c.id, symbol: transposeChordSymbol(c.symbol, semitones) }));
    const song_key = song.song_key ? transposeChordSymbol(song.song_key, semitones) : undefined;
    void guard(async () => {
      await api.writeTransposedChords(song.id, { song_key, chords });
      await reload(song.id);
    });
  }

  function onExportChordPro() {
    if (!song) return;
    void guard(() => api.exportChordPro(song.id));
  }

  function onExportMidi() {
    if (!song) return;
    void guard(() => api.exportMidi(song.id));
  }

  /** Creates a new song and switches to it. Never touches the currently open song. */
  function onImportChordPro(text: string) {
    void (async () => {
      try {
        const res = await api.importChordPro(text);
        setSongs(await api.listSongs());
        setActiveLineId(null);
        await reload(res.song_id);
        setError(res.warnings.length > 0 ? `Imported with notes: ${res.warnings.join('; ')}` : null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setNeedsToken(true);
          setError('That token was rejected.');
          return;
        }
        setError(err instanceof Error ? err.message : 'import failed');
      }
    })();
  }

  /** Debounced per line: typing in one line never delays a save in another. */
  function editLine(id: number, text: string) {
    if (!song) return;
    setSong({
      ...song,
      sections: song.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === id ? { ...l, text } : l)),
      })),
    });
    const existing = timers.current.get(id);
    if (existing) window.clearTimeout(existing);
    setSaving(true);
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        void guard(async () => {
          await api.patchLine(id, { text });
          await reload(song.id);
        }).finally(() => setSaving(timers.current.size > 0));
      }, 500),
    );
  }

  if (needsToken) {
    return <TokenGate onSaved={() => {
      setNeedsToken(false);
      void refreshList();
    }} />;
  }

  return (
    <>
    <div className="app">
      <nav className="rail">
        <h1 className="brand">
          songsmith<span className="cursor" aria-hidden="true" />
        </h1>
        <button
          className="solid wide"
          onClick={() =>
            void guard(async () => {
              const created = await api.createSong('Untitled');
              setSong(created);
              setGrid(await api.getGrid(created.id));
              setActiveLineId(null);
              setSongs(await api.listSongs());
            })
          }
        >
          New song
        </button>
        <ul className="song-list">
          {songs.map((s) => (
            <li key={s.id}>
              <button
                className={song?.id === s.id ? 'song-btn on' : 'song-btn'}
                onClick={() => {
                  setActiveLineId(null);
                  setPlayheadBar(null);
                  setLivePosition(null);
                  void reload(s.id);
                }}
              >
                <span className="song-title">{s.title}</span>
                <span className="song-sub">
                  {s.song_key ?? '—'} · {s.updated_at.slice(0, 10)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {songs.length === 0 ? <p className="hint">No songs yet. Start one.</p> : null}
      </nav>

      <main className="stage">
        {error ? (
          <div className="banner" role="alert">
            {error}
            <button className="link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {!song ? (
          <p className="empty big">Pick a song on the left, or start a new one.</p>
        ) : (
          <>
            <header className="song-head">
              <input
                className="song-title-input"
                value={song.title}
                aria-label="Song title"
                onChange={(e) => {
                  setSong({ ...song, title: e.target.value });
                  void guard(async () => {
                    await api.patchSong(song.id, { title: e.target.value });
                    setSongs(await api.listSongs());
                  });
                }}
              />
              <input
                className="key-input"
                value={song.song_key ?? ''}
                placeholder="key"
                aria-label="Song key"
                onChange={(e) => {
                  const song_key = e.target.value || null;
                  setSong({ ...song, song_key });
                  void guard(async () => {
                    await api.patchSong(song.id, { song_key });
                  });
                }}
              />
              <span className={saving ? 'save-state on' : 'save-state'}>
                {saving ? 'saving' : 'saved'}
              </span>
              <TempoControl song={song} onChange={patchTempo} />
              <TransposeControl song={song} onTranspose={onTranspose} />
              <ExportControls
                onExportChordPro={onExportChordPro}
                onExportMidi={onExportMidi}
                onImport={onImportChordPro}
              />
              <Transport
                song={song}
                chords={grid?.chords ?? []}
                onTick={(bar, beat) => {
                  setPlayheadBar(bar);
                  const gridLine = activeLineId
                    ? grid?.lines.find((l) => l.line_id === activeLineId)
                    : undefined;
                  const idx = landingSyllable(gridLine, bar, beat);
                  setLivePosition(activeLineId !== null && idx !== null ? [activeLineId, idx] : null);
                }}
                onStop={() => {
                  setPlayheadBar(null);
                  setLivePosition(null);
                }}
              />
            </header>

            <Sheet
              song={song}
              grid={grid}
              activeLineId={activeLineId}
              livePosition={livePosition}
              playheadBar={playheadBar}
              diatonicSuggestions={diatonicSuggestions}
              onSelectLine={setActiveLineId}
              onEditLine={editLine}
              onAddLine={(sectionId, afterId) =>
                void guard(async () => {
                  const line = await api.addLine(sectionId, '', afterId);
                  await reload(song.id);
                  setActiveLineId(line.id);
                })
              }
              onDeleteLine={(id) =>
                void guard(async () => {
                  await api.deleteLine(id);
                  setActiveLineId(null);
                  await reload(song.id);
                })
              }
              onMoveLine={(id, beforeId) =>
                void guard(async () => {
                  await api.patchLine(id, { before_id: beforeId });
                  await reload(song.id);
                })
              }
              onRenameSection={(id, name) => {
                setSong({
                  ...song,
                  sections: song.sections.map((s) => (s.id === id ? { ...s, name } : s)),
                });
                void guard(async () => {
                  await api.patchSection(id, { name });
                });
              }}
              onSectionBarCount={onSectionBarCount}
              onAddSection={(afterId) =>
                void guard(async () => {
                  await api.addSection(song.id, 'Verse', afterId);
                  await reload(song.id);
                })
              }
              onDeleteSection={(id) =>
                void guard(async () => {
                  await api.deleteSection(id);
                  setActiveLineId(null);
                  await reload(song.id);
                })
              }
              onAssignLineToBar={onAssignLineToBar}
              onSetLineBarBeat={onSetLineBarBeat}
              onToggleAnchor={onToggleAnchor}
              onClearTiming={onClearTiming}
              onAddChord={onAddChord}
              onMoveChord={onMoveChord}
              onRenameChord={onRenameChord}
              onDeleteChord={onDeleteChord}
            />
          </>
        )}
      </main>

      {song ? (
        <Inspector
          line={activeLine}
          songId={song.id}
          onError={setError}
          onRestored={() => {
            setActiveLineId(null);
            void reload(song.id);
          }}
          onPromote={(index) =>
            void guard(async () => {
              await api.promoteAlternate(activeLine!.id, index);
              await reload(song.id);
            })
          }
          onStash={() =>
            void guard(async () => {
              const l = activeLine!;
              await api.patchLine(l.id, { alternates: [l.text, ...l.alternates], text: '' });
              await reload(song.id);
            })
          }
          onDiscard={(index) =>
            void guard(async () => {
              const l = activeLine!;
              await api.patchLine(l.id, {
                alternates: l.alternates.filter((_, i) => i !== index),
              });
              await reload(song.id);
            })
          }
        />
      ) : null}
    </div>
    {song ? <PrintSheet song={song} grid={grid} /> : null}
    </>
  );
}

function TokenGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState(getToken());
  return (
    <div className="gate">
      <h1 className="brand">songsmith</h1>
      <p className="hint">
        This server is running with a token. Paste it to continue — it's stored in this browser only.
      </p>
      <input
        className="word-input"
        type="password"
        value={value}
        aria-label="Access token"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setToken(value);
            onSaved();
          }
        }}
      />
      <button
        className="solid"
        onClick={() => {
          setToken(value);
          onSaved();
        }}
      >
        Continue
      </button>
    </div>
  );
}
