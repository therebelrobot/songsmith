export interface Syllable {
  text: string;
  stress: number;
}

export interface WordProsody {
  word: string;
  count: number;
  known: boolean;
  syllables: Syllable[];
  rhymeKey: string | null;
}

export interface Line {
  id: number;
  position: number;
  text: string;
  syllables: WordProsody[];
  alternates: string[];
  syllable_count: number;
  rhyme_key: string | null;
  rhyme_label: string | null;
}

export interface Section {
  id: number;
  song_id: number;
  name: string;
  position: number;
  bar_count: number | null;
  lines: Line[];
}

export interface Song {
  id: number;
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  meter_num: number;
  meter_den: number;
  notes: string;
  /** 0 or 1, straight from the sqlite column — falls back to root-position-only chords when 0. */
  voice_leading: number;
  /** 'names' or 'numbers' — display only, computed client-side; never changes what's stored. */
  chord_display: string;
  updated_at: string;
  sections: Section[];
}

export interface SongStub {
  id: number;
  title: string;
  song_key: string | null;
  tempo_bpm: number | null;
  updated_at: string;
}

export interface Revision {
  id: number;
  label: string;
  created_at: string;
}

export interface RhymeMatch {
  word: string;
  score: number;
  syllables: number;
}

/** index is ordinal into a line's flattened syllable list; offset is sixteenth notes from the line's start. */
export interface SyllableAnchor {
  index: number;
  offset: number;
}

export interface LineTiming {
  line_id: number;
  start_bar: number;
  start_beat: number;
  syllable_offsets: SyllableAnchor[];
}

export interface GridSyllable {
  index: number;
  bar: number;
  beat: number;
  /** true when this syllable is an explicit anchor rather than interpolated */
  pinned: boolean;
}

export interface GridLine {
  line_id: number;
  start_bar: number;
  start_beat: number;
  syllables: GridSyllable[];
}

export interface Chord {
  id: number;
  song_id: number;
  bar: number;
  beat: number;
  symbol: string;
  duration_beats: number;
}

/** A chord plus where it lands, if anywhere — computed server-side by src/music/leadsheet.ts. */
export interface PlacedChord extends Chord {
  line_id: number | null;
  syllable_index: number | null;
  /** MIDI note numbers, resolved server-side by src/music/voiceLeading.ts — play these, don't recompute a voicing. */
  voicing: number[];
}

export interface Grid {
  meter_num: number;
  meter_den: number;
  tempo_bpm: number | null;
  voice_leading: boolean;
  lines: GridLine[];
  chords: PlacedChord[];
}

/**
 * Recover a syllable's line-relative offset (sixteenth notes) from its
 * resolved bar/beat. Exact for pinned syllables, since those are the fixed
 * points resolveLineTiming() interpolates around — this is just the inverse
 * unit conversion, not a reimplementation of the interpolation itself.
 */
export function offsetOf(
  gridLine: { start_bar: number; start_beat: number },
  beatsPerBar: number,
  syllable: { bar: number; beat: number },
): number {
  return (
    ((syllable.bar - gridLine.start_bar) * beatsPerBar + (syllable.beat - gridLine.start_beat)) * 4
  );
}

const TOKEN_KEY = 'songsmith.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(value: string): void {
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Thrown for any non-2xx. `status` lets the UI distinguish 401 from a real fault. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fetches a file with the auth header a plain `<a href>` can't carry, then triggers a browser download. */
async function download(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const text = await res.text();
    let message = `request failed with ${res.status}`;
    try {
      message = (JSON.parse(text) as { error?: string })?.error ?? message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `request failed with ${res.status}`);
  }
  return body as T;
}

export const api = {
  listSongs: () => request<SongStub[]>('/api/songs'),
  getSong: (id: number) => request<Song>(`/api/songs/${id}`),
  createSong: (title: string) =>
    request<Song>('/api/songs', { method: 'POST', body: JSON.stringify({ title }) }),
  patchSong: (id: number, patch: Record<string, unknown>) =>
    request<Song>(`/api/songs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSong: (id: number) => request<void>(`/api/songs/${id}`, { method: 'DELETE' }),

  addSection: (songId: number, name: string, afterId?: number) =>
    request<Section>(`/api/songs/${songId}/sections`, {
      method: 'POST',
      body: JSON.stringify({ name, after_id: afterId ?? null }),
    }),
  patchSection: (id: number, patch: Record<string, unknown>) =>
    request<Section>(`/api/sections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSection: (id: number) => request<void>(`/api/sections/${id}`, { method: 'DELETE' }),

  addLine: (sectionId: number, text: string, afterId?: number) =>
    request<Line>(`/api/sections/${sectionId}/lines`, {
      method: 'POST',
      body: JSON.stringify({ text, after_id: afterId ?? null }),
    }),
  patchLine: (id: number, patch: Record<string, unknown>) =>
    request<Line>(`/api/lines/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  promoteAlternate: (id: number, index: number) =>
    request<Line>(`/api/lines/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ index }),
    }),
  deleteLine: (id: number) => request<void>(`/api/lines/${id}`, { method: 'DELETE' }),

  listRevisions: (songId: number) => request<Revision[]>(`/api/songs/${songId}/revisions`),
  snapshot: (songId: number, label: string) =>
    request<{ id: number }>(`/api/songs/${songId}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  restore: (revisionId: number) =>
    request<Song>(`/api/revisions/${revisionId}/restore`, { method: 'POST' }),

  rhymes: (word: string, minScore: number, limit = 40) =>
    request<{ word: string; rhyme_key: string; matches: RhymeMatch[] }>(
      `/api/prosody/rhymes?word=${encodeURIComponent(word)}&min_score=${minScore}&limit=${limit}`,
    ),

  getGrid: (songId: number) => request<Grid>(`/api/songs/${songId}/grid`),
  putLineTiming: (
    lineId: number,
    timing: { start_bar: number; start_beat: number; syllable_offsets: SyllableAnchor[] },
  ) =>
    request<LineTiming>(`/api/lines/${lineId}/timing`, {
      method: 'PUT',
      body: JSON.stringify(timing),
    }),
  deleteLineTiming: (lineId: number) =>
    request<void>(`/api/lines/${lineId}/timing`, { method: 'DELETE' }),

  addChord: (
    songId: number,
    chord: { bar: number; beat: number; symbol: string; duration_beats?: number; replace?: boolean },
  ) =>
    request<Chord>(`/api/songs/${songId}/chords`, { method: 'POST', body: JSON.stringify(chord) }),
  moveChord: (id: number, patch: { bar?: number; beat?: number; replace?: boolean }) =>
    request<Chord>(`/api/chords/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  patchChord: (id: number, patch: { symbol?: string; duration_beats?: number }) =>
    request<Chord>(`/api/chords/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteChord: (id: number) => request<void>(`/api/chords/${id}`, { method: 'DELETE' }),
  exportChordPro: (songId: number) => download(`/api/songs/${songId}/export.chordpro`, 'song.chordpro'),
  exportMidi: (songId: number) => download(`/api/songs/${songId}/export.mid`, 'song.mid'),
  exportStrudel: (songId: number) => download(`/api/songs/${songId}/export.strudel.js`, 'song.strudel.js'),
  importChordPro: (text: string) =>
    request<{ song_id: number; warnings: string[] }>('/api/import/chordpro', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  writeTransposedChords: (
    songId: number,
    payload: { song_key?: string; chords: { id: number; symbol: string }[] },
  ) =>
    request<{ song: Song; chords: Chord[] }>(`/api/songs/${songId}/transpose`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
