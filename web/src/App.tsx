import { useMemo, useState } from 'react';
import { getToken, setToken, type GridLine } from './api';
import { diatonicChordsForKey } from './chords';
import { Sheet } from './components/Sheet';
import { Inspector } from './components/Inspector';
import { TempoControl } from './components/TempoControl';
import { Transport } from './components/Transport';
import { TransposeControl } from './components/TransposeControl';
import { ExportControls } from './components/ExportControls';
import { ChordDisplayToggle } from './components/ChordDisplayToggle';
import { PrintSheet } from './components/PrintSheet';
import { useSong } from './hooks/useSong';

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
  const [activeLineId, setActiveLineId] = useState<number | null>(null);
  const [playheadBar, setPlayheadBar] = useState<number | null>(null);
  const [livePosition, setLivePosition] = useState<readonly [number, number] | null>(null);

  const {
    songs,
    song,
    grid,
    error,
    setError,
    needsToken,
    setNeedsToken,
    saving,
    pendingFocus,
    clearPendingFocus,
    refreshList,
    reload,
    openSong,
    createSong,
    patchTitle,
    patchKey,
    patchVoiceLeading,
    patchChordDisplay,
    patchTempo,
    onSectionBarCount,
    onAssignLineToBar,
    onSetLineBarBeat,
    onToggleAnchor,
    onClearTiming,
    onAddChord,
    onMoveChord,
    onRenameChord,
    onDeleteChord,
    onTranspose,
    onExportChordPro,
    onExportMidi,
    onImportChordPro,
    editLine,
    onAddLine,
    onDeleteLine,
    onMoveLine,
    onRenameSection,
    onAddSection,
    onDeleteSection,
    onPromote,
    onStash,
    onDiscard,
  } = useSong(setActiveLineId);

  const activeLine = song?.sections.flatMap((s) => s.lines).find((l) => l.id === activeLineId) ?? null;
  const diatonicSuggestions = useMemo(() => diatonicChordsForKey(song?.song_key ?? null), [song?.song_key]);

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
        <button className="solid wide" onClick={() => createSong('Untitled')}>
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
                onChange={(e) => patchTitle(e.target.value)}
              />
              <input
                className="key-input"
                value={song.song_key ?? ''}
                placeholder="key"
                aria-label="Song key"
                onChange={(e) => patchKey(e.target.value || null)}
              />
              <label className="voice-leading-toggle" title="Blocked root-position chords when off">
                <input
                  type="checkbox"
                  checked={!!song.voice_leading}
                  aria-label="Voice leading"
                  onChange={(e) => patchVoiceLeading(e.target.checked)}
                />
                voice leading
              </label>
              <ChordDisplayToggle
                chordDisplay={song.chord_display}
                songKey={song.song_key}
                onChange={patchChordDisplay}
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
              pendingFocus={pendingFocus}
              onFocusHandled={clearPendingFocus}
              onSelectLine={setActiveLineId}
              onEditLine={editLine}
              onAddLine={onAddLine}
              onDeleteLine={onDeleteLine}
              onMoveLine={onMoveLine}
              onRenameSection={onRenameSection}
              onSectionBarCount={onSectionBarCount}
              onAddSection={onAddSection}
              onDeleteSection={onDeleteSection}
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
          onPromote={(index) => activeLine && onPromote(activeLine, index)}
          onStash={() => activeLine && onStash(activeLine)}
          onDiscard={(index) => activeLine && onDiscard(activeLine, index)}
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
