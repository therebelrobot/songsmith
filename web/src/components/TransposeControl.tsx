import type { Song } from '../api';

interface Props {
  song: Song;
  onTranspose: (semitones: number) => void;
}

/** Shifts every chord symbol (and the song key, if set) by a semitone at a time. */
export function TransposeControl({ song, onTranspose }: Props) {
  return (
    <div className="transpose">
      <span className="tempo-label">key</span>
      <button className="ghost" onClick={() => onTranspose(-1)} title="Transpose down a semitone">
        −1
      </button>
      <span className="key-display">{song.song_key ?? '—'}</span>
      <button className="ghost" onClick={() => onTranspose(1)} title="Transpose up a semitone">
        +1
      </button>
    </div>
  );
}
