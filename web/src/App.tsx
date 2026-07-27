import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, getToken, setToken, type Song, type SongStub } from './api';
import { Sheet } from './components/Sheet';
import { Inspector } from './components/Inspector';

export default function App() {
  const [songs, setSongs] = useState<SongStub[]>([]);
  const [song, setSong] = useState<Song | null>(null);
  const [activeLineId, setActiveLineId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const timers = useRef(new Map<number, number>());
  const activeLine = song?.sections.flatMap((s) => s.lines).find((l) => l.id === activeLineId) ?? null;

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
    (id: number) => guard(async () => setSong(await api.getSong(id))),
    [guard],
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

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
            </header>

            <Sheet
              song={song}
              activeLineId={activeLineId}
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
