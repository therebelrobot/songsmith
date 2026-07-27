interface Props {
  /** absolute bar number of this section's first bar, across the whole song */
  startBar: number;
  barCount: number;
  meterNum: number;
  /** absolute bar currently sounding, if this section is where playback is */
  playheadBar?: number | null;
  onDropBar?: (bar: number) => void;
}

/**
 * One tick per bar, one mark per beat inside it. Sized from the section's
 * bar_count and meter — no pixel-per-tick timeline, no draggable regions.
 */
export function BarRuler({ startBar, barCount, meterNum, playheadBar, onDropBar }: Props) {
  const bars = Array.from({ length: barCount }, (_, i) => startBar + i);
  return (
    <div className="ruler" role="list" aria-label={`${barCount} bars`}>
      {bars.map((bar) => (
        <div
          key={bar}
          role="listitem"
          className={bar === playheadBar ? 'ruler-bar ruler-bar-live' : 'ruler-bar'}
          onDragOver={onDropBar ? (e) => e.preventDefault() : undefined}
          onDrop={onDropBar ? () => onDropBar(bar) : undefined}
        >
          <span className="ruler-bar-num">{bar}</span>
          <span className="ruler-beats" aria-hidden="true">
            {Array.from({ length: meterNum }, (_, i) => (
              <i key={i} className="ruler-beat" />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
