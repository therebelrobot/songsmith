import { useEffect, useRef, useState } from 'react';
import { Metronome } from '../audio/metronome';
import type { PlacedChord, Song } from '../api';
import { voiceChord } from '../chords';

interface Props {
  song: Song;
  chords: PlacedChord[];
  onTick: (bar: number, beat: number) => void;
  onStop: () => void;
}

/** Play/stop plus a "from bar" field. All audio runs here, client-side only. */
export function Transport({ song, chords, onTick, onStop }: Props) {
  const [playing, setPlaying] = useState(false);
  const [fromBar, setFromBar] = useState(1);
  const metroRef = useRef<Metronome | null>(null);

  useEffect(() => () => metroRef.current?.stop(), []);

  function play() {
    if (!song.tempo_bpm) return;
    const chordEvents = chords
      .map((c) => ({
        bar: c.bar,
        beat: c.beat,
        durationBeats: c.duration_beats,
        frequencies: voiceChord(c.symbol).map((v) => v.frequency),
      }))
      .filter((c) => c.frequencies.length > 0);
    const m = new Metronome({
      bpm: song.tempo_bpm,
      beatsPerBar: song.meter_num,
      onTick,
      chords: chordEvents,
    });
    metroRef.current = m;
    m.start(fromBar);
    setPlaying(true);
  }

  function stop() {
    metroRef.current?.stop();
    metroRef.current = null;
    setPlaying(false);
    onStop();
  }

  return (
    <div className="transport">
      <label className="tempo-field">
        <span className="tempo-label">from bar</span>
        <input
          type="number"
          min={1}
          className="bar-input"
          value={fromBar}
          aria-label="Play from bar"
          disabled={playing}
          onChange={(e) => setFromBar(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      {playing ? (
        <button className="ghost" onClick={stop}>
          Stop
        </button>
      ) : (
        <button
          className="solid"
          onClick={play}
          disabled={!song.tempo_bpm}
          title={song.tempo_bpm ? undefined : 'set a tempo first'}
        >
          Play
        </button>
      )}
    </div>
  );
}
