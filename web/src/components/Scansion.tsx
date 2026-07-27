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

/** Syllable segmentation shown under the active line, e.g. "ne·ver  meant  to". */
export function Segmentation({ words }: { words: WordProsody[] }) {
  return (
    <div className="segmentation">
      {words.map((w, wi) => (
        <span key={wi} className={w.known ? 'seg' : 'seg seg-guess'} title={w.known ? undefined : 'not in dictionary — count estimated'}>
          {w.syllables.map((s, si) => (
            <span key={si} className={`syl stress-${s.stress}`}>
              {s.text}
              {si < w.syllables.length - 1 ? <b className="dot">·</b> : null}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
