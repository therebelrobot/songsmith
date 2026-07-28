import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  offsetOf,
  type Grid,
  type Line,
  type Song,
  type SongStub,
  type SyllableAnchor,
} from '../api';
import { transposeChordSymbol } from '../chords';
import { anchorsOf } from '../components/Sheet';
import { focusTargetAfterDelete, type PendingFocus } from '../focus';

/**
 * Owns the loaded song/grid, the debounced per-line autosave, and every
 * mutation that touches them. `setActiveLineId` is passed in rather than
 * owned here because a few mutations (adding a line, deleting a line or
 * section, importing) need to move or clear the editor's selection, and that
 * selection is App.tsx's UI state, not song data.
 */
export function useSong(setActiveLineId: (id: number | null) => void) {
  const [songs, setSongs] = useState<SongStub[]>([]);
  const [song, setSong] = useState<Song | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus>(null);

  const timers = useRef(new Map<number, number>());

  const clearPendingFocus = useCallback(() => setPendingFocus(null), []);

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

  /** Loads a song and focuses its first line, caret at the end — unlike reload(), which never steals focus. */
  function openSong(id: number) {
    void guard(async () => {
      const [s, g] = await Promise.all([api.getSong(id), api.getGrid(id)]);
      setSong(s);
      setGrid(g);
      const firstLine = s.sections.flatMap((sec) => sec.lines)[0];
      setPendingFocus(firstLine ? { kind: 'line', id: firstLine.id } : null);
    });
  }

  function createSong(title: string) {
    void guard(async () => {
      const created = await api.createSong(title);
      setSong(created);
      setGrid(await api.getGrid(created.id));
      setActiveLineId(null);
      setSongs(await api.listSongs());
    });
  }

  function patchTitle(title: string) {
    if (!song) return;
    setSong({ ...song, title });
    void guard(async () => {
      await api.patchSong(song.id, { title });
      setSongs(await api.listSongs());
    });
  }

  function patchKey(song_key: string | null) {
    if (!song) return;
    setSong({ ...song, song_key });
    void guard(async () => {
      await api.patchSong(song.id, { song_key });
    });
  }

  function patchVoiceLeading(voice_leading: boolean) {
    if (!song) return;
    setSong({ ...song, voice_leading: voice_leading ? 1 : 0 });
    void guard(async () => {
      await api.patchSong(song.id, { voice_leading });
      await reload(song.id);
    });
  }

  function patchChordDisplay(chord_display: 'names' | 'numbers') {
    if (!song) return;
    setSong({ ...song, chord_display });
    void guard(async () => {
      await api.patchSong(song.id, { chord_display });
    });
  }

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

  function onAddLine(sectionId: number, afterId?: number) {
    if (!song) return;
    void guard(async () => {
      const line = await api.addLine(sectionId, '', afterId);
      await reload(song.id);
      setActiveLineId(line.id);
      setPendingFocus({ kind: 'line', id: line.id });
    });
  }

  function onDeleteLine(id: number) {
    if (!song) return;
    const target = focusTargetAfterDelete(song.sections, id);
    void guard(async () => {
      await api.deleteLine(id);
      await reload(song.id);
      setActiveLineId(target?.id ?? null);
      setPendingFocus(target);
    });
  }

  function onMoveLine(id: number, beforeId: number) {
    if (!song) return;
    void guard(async () => {
      await api.patchLine(id, { before_id: beforeId });
      await reload(song.id);
    });
  }

  function onRenameSection(id: number, name: string) {
    if (!song) return;
    setSong({
      ...song,
      sections: song.sections.map((s) => (s.id === id ? { ...s, name } : s)),
    });
    void guard(async () => {
      await api.patchSection(id, { name });
    });
  }

  function onAddSection(afterId?: number) {
    if (!song) return;
    void guard(async () => {
      const section = await api.addSection(song.id, 'Verse', afterId);
      await reload(song.id);
      setPendingFocus({ kind: 'section', id: section.id });
    });
  }

  function onDeleteSection(id: number) {
    if (!song) return;
    void guard(async () => {
      await api.deleteSection(id);
      setActiveLineId(null);
      await reload(song.id);
    });
  }

  function onPromote(line: Line, index: number) {
    if (!song) return;
    void guard(async () => {
      await api.promoteAlternate(line.id, index);
      await reload(song.id);
    });
  }

  function onStash(line: Line) {
    if (!song) return;
    void guard(async () => {
      await api.patchLine(line.id, { alternates: [line.text, ...line.alternates], text: '' });
      await reload(song.id);
    });
  }

  function onDiscard(line: Line, index: number) {
    if (!song) return;
    void guard(async () => {
      await api.patchLine(line.id, {
        alternates: line.alternates.filter((_, i) => i !== index),
      });
      await reload(song.id);
    });
  }

  return {
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
  };
}
