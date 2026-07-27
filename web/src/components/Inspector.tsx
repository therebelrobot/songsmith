import { useEffect, useState } from 'react';
import { api, type Line, type Revision, type RhymeMatch } from '../api';

type Tab = 'alternates' | 'rhymes' | 'history';

interface Props {
  line: Line | null;
  songId: number;
  onPromote: (index: number) => void;
  onStash: () => void;
  onDiscard: (index: number) => void;
  onRestored: () => void;
  onError: (message: string) => void;
}

export function Inspector({ line, songId, onPromote, onStash, onDiscard, onRestored, onError }: Props) {
  const [tab, setTab] = useState<Tab>('alternates');

  return (
    <aside className="inspector">
      <nav className="tabs" role="tablist">
        {(['alternates', 'rhymes', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'tab-btn on' : 'tab-btn'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'alternates' ? (
        <Alternates line={line} onPromote={onPromote} onStash={onStash} onDiscard={onDiscard} />
      ) : null}
      {tab === 'rhymes' ? <Rhymes line={line} onError={onError} /> : null}
      {tab === 'history' ? <History songId={songId} onRestored={onRestored} onError={onError} /> : null}
    </aside>
  );
}

function Alternates({
  line,
  onPromote,
  onStash,
  onDiscard,
}: {
  line: Line | null;
  onPromote: (i: number) => void;
  onStash: () => void;
  onDiscard: (i: number) => void;
}) {
  if (!line) return <p className="hint">Select a line to see its alternates.</p>;
  return (
    <div className="panel">
      <p className="hint">
        Stashing keeps the current wording and clears the line so you can try another. Promoting
        swaps them back. Nothing is deleted unless you discard it.
      </p>
      <button className="solid" onClick={onStash} disabled={line.text.trim() === ''}>
        Stash this wording
      </button>
      {line.alternates.length === 0 ? (
        <p className="hint">No alternates stashed for this line.</p>
      ) : (
        <ul className="alts">
          {line.alternates.map((alt, i) => (
            <li key={i}>
              <span className="alt-text">{alt || <em>(empty)</em>}</span>
              <span className="alt-actions">
                <button className="ghost" onClick={() => onPromote(i)}>
                  Use this
                </button>
                <button className="ghost danger" onClick={() => onDiscard(i)}>
                  Discard
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rhymes({ line, onError }: { line: Line | null; onError: (m: string) => void }) {
  const lastWord = line?.text.trim().split(/\s+/).at(-1)?.replace(/[^\p{L}']/gu, '') ?? '';
  const [word, setWord] = useState(lastWord);
  const [slant, setSlant] = useState(false);
  const [matches, setMatches] = useState<RhymeMatch[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing'>('idle');

  useEffect(() => {
    setWord(lastWord);
    setMatches(null);
    setState('idle');
  }, [lastWord]);

  async function look() {
    if (!word) return;
    setState('loading');
    try {
      const r = await api.rhymes(word, slant ? 0.5 : 1);
      setMatches(r.matches);
      setState('idle');
    } catch (err) {
      setMatches(null);
      // 404 means the word isn't in the dictionary — that's information, not a fault.
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        setState('missing');
      } else {
        setState('idle');
        onError(err instanceof Error ? err.message : 'rhyme lookup failed');
      }
    }
  }

  return (
    <div className="panel">
      <div className="rhyme-controls">
        <input
          className="word-input"
          value={word}
          placeholder="word"
          aria-label="Word to rhyme"
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void look();
          }}
        />
        <button className="solid" onClick={() => void look()} disabled={!word}>
          Find
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={slant} onChange={(e) => setSlant(e.target.checked)} />
        Include slant rhymes
      </label>

      {state === 'loading' ? <p className="hint">Looking…</p> : null}
      {state === 'missing' ? (
        <p className="hint">
          <b>{word}</b> isn't in the dictionary, so there's nothing to match against. Proper nouns
          and invented words land here often.
        </p>
      ) : null}
      {matches && matches.length === 0 ? <p className="hint">No matches at this threshold.</p> : null}
      {matches && matches.length > 0 ? (
        <ul className="rhyme-list">
          {matches.map((m) => (
            <li key={m.word}>
              <span>{m.word}</span>
              <span className="rhyme-meta">
                {m.syllables}
                {slant ? ` · ${m.score.toFixed(2)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function History({
  songId,
  onRestored,
  onError,
}: {
  songId: number;
  onRestored: () => void;
  onError: (m: string) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [label, setLabel] = useState('');

  async function refresh() {
    try {
      setRevisions(await api.listRevisions(songId));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'could not load history');
    }
  }

  useEffect(() => {
    void refresh();
  }, [songId]);

  return (
    <div className="panel">
      <p className="hint">
        A snapshot copies the whole song. Restoring snapshots the current state first, so you can
        always come back.
      </p>
      <div className="rhyme-controls">
        <input
          className="word-input"
          value={label}
          placeholder="what's this version?"
          aria-label="Snapshot label"
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="solid"
          onClick={async () => {
            try {
              await api.snapshot(songId, label);
              setLabel('');
              await refresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'snapshot failed');
            }
          }}
        >
          Snapshot
        </button>
      </div>
      {revisions.length === 0 ? (
        <p className="hint">No snapshots yet.</p>
      ) : (
        <ul className="revs">
          {revisions.map((r) => (
            <li key={r.id}>
              <span>
                <b>{r.label || 'unlabelled'}</b>
                <em>{r.created_at}</em>
              </span>
              <button
                className="ghost"
                onClick={async () => {
                  try {
                    await api.restore(r.id);
                    onRestored();
                    await refresh();
                  } catch (err) {
                    onError(err instanceof Error ? err.message : 'restore failed');
                  }
                }}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
