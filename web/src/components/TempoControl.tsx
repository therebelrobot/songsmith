import { useRef } from 'react';
import type { Song } from '../api';

interface Props {
  song: Song;
  onChange: (patch: { tempo_bpm?: number | null; meter_num?: number; meter_den?: number }) => void;
}

const METER_DENOMS = [1, 2, 4, 8, 16];
const TAP_GAP_RESET_MS = 2000;
const TAP_WINDOW = 6;

export function TempoControl({ song, onChange }: Props) {
  const taps = useRef<number[]>([]);

  function tap() {
    const now = performance.now();
    const last = taps.current.at(-1);
    if (last !== undefined && now - last > TAP_GAP_RESET_MS) taps.current = [];
    taps.current = [...taps.current, now].slice(-TAP_WINDOW);
    if (taps.current.length < 2) return;
    const intervals = taps.current.slice(1).map((t, i) => t - (taps.current[i] as number));
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    onChange({ tempo_bpm: Math.round(60000 / avgMs) });
  }

  return (
    <div className="tempo">
      <label className="tempo-field">
        <span className="tempo-label">bpm</span>
        <input
          className="tempo-input"
          type="number"
          min={20}
          max={400}
          value={song.tempo_bpm ?? ''}
          placeholder="—"
          aria-label="Tempo in BPM"
          onChange={(e) => onChange({ tempo_bpm: e.target.value ? Number(e.target.value) : null })}
        />
      </label>
      <button className="ghost" onClick={tap} title="Tap a few times to set the tempo by feel">
        Tap
      </button>
      <label className="tempo-field">
        <input
          className="meter-input"
          type="number"
          min={1}
          max={32}
          value={song.meter_num}
          aria-label="Beats per bar"
          onChange={(e) => onChange({ meter_num: Math.max(1, Number(e.target.value) || 1) })}
        />
        <span aria-hidden="true">/</span>
        <select
          className="meter-select"
          value={song.meter_den}
          aria-label="Note value that gets the beat"
          onChange={(e) => onChange({ meter_den: Number(e.target.value) })}
        >
          {METER_DENOMS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
