import type { WordProsody } from '../api';

/**
 * The stress sparkline. One mark per syllable, height encoding stress:
 * primary (1) is full, secondary (2) is half, unstressed (0) is a low tick.
 * Word boundaries get a hairline gap so you can read the phrasing.
 *
 * This is the thing that makes two verses comparable at a glance — if verse 2
 * scans like verse 1, the two sparklines have the same silhouette.
 */
export function StressLine({ words }: { words: WordProsody[] }) {
  if (words.length === 0) return <span className="scan scan-empty">·</span>;
  return (
    <span className="scan" aria-hidden="true">
      {words.map((w, wi) => (
        <span key={wi} className="scan-word">
          {w.syllables.map((s, si) => (
            <i
              key={si}
              className={
                s.stress === 1
                  ? 'mark mark-strong'
                  : s.stress === 2
                    ? 'mark mark-mid'
                    : s.stress === 0
                      ? 'mark mark-weak'
                      : 'mark mark-unknown'
              }
            />
          ))}
        </span>
      ))}
    </span>
  );
}

export function scansionLabel(words: WordProsody[]): string {
  const marks = words
    .flatMap((w) => w.syllables.map((s) => (s.stress === 1 ? '/' : s.stress === 2 ? '\\' : 'x')))
    .join('');
  return marks || 'no syllables';
}

/**
 * Syllable segmentation shown under the active line, e.g. "ne·ver  meant  to".
 * When `onToggleAnchor` is given, clicking a syllable pins it to its current
 * beat position (or unpins it if already pinned) — this is the whole
 * anchoring interaction, no drag, no timeline.
 */
export function Segmentation({
  words,
  pinned,
  liveIndex,
  onToggleAnchor,
}: {
  words: WordProsody[];
  pinned?: ReadonlySet<number>;
  liveIndex?: number | null;
  onToggleAnchor?: (index: number) => void;
}) {
  let index = -1;
  return (
    <div className="segmentation">
      {words.map((w, wi) => (
        <span key={wi} className={w.known ? 'seg' : 'seg seg-guess'} title={w.known ? undefined : 'not in dictionary — count estimated'}>
          {w.syllables.map((s, si) => {
            index += 1;
            const i = index;
            const isPinned = pinned?.has(i) ?? false;
            const classes = ['syl', `stress-${s.stress}`];
            if (isPinned) classes.push('syl-pinned');
            if (liveIndex === i) classes.push('syl-live');
            return (
              <span
                key={si}
                className={classes.join(' ')}
                role={onToggleAnchor ? 'button' : undefined}
                tabIndex={onToggleAnchor ? 0 : undefined}
                title={onToggleAnchor ? (isPinned ? 'click to unpin' : 'click to pin to this beat') : undefined}
                onClick={onToggleAnchor ? () => onToggleAnchor(i) : undefined}
                onKeyDown={
                  onToggleAnchor
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onToggleAnchor(i);
                        }
                      }
                    : undefined
                }
              >
                {s.text}
                {si < w.syllables.length - 1 ? <b className="dot">·</b> : null}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}
