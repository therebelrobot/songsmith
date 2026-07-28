interface Props {
  chordDisplay: string;
  songKey: string | null;
  onChange: (chordDisplay: 'names' | 'numbers') => void;
}

/**
 * The names/numbers toggle in the song header, next to voice leading. A key
 * is required to number chords against — with none set, the toggle is
 * disabled with a title explaining why, rather than silently defaulting to
 * a key or showing nothing.
 */
export function ChordDisplayToggle({ chordDisplay, songKey, onChange }: Props) {
  return (
    <label
      className="voice-leading-toggle"
      title={
        songKey
          ? 'Show chord numbers (Nashville Number System) instead of letter names'
          : 'Set a key to show chord numbers'
      }
    >
      <input
        type="checkbox"
        checked={chordDisplay === 'numbers'}
        disabled={!songKey}
        aria-label="Chord numbers"
        onChange={(e) => onChange(e.target.checked ? 'numbers' : 'names')}
      />
      numbers
    </label>
  );
}
