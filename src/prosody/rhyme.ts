import { analyzeLine } from './syllables';

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface RhymeScheme {
  /** One entry per input line. `null` when the last word is not in the dictionary. */
  labels: (string | null)[];
  keys: (string | null)[];
  counts: number[];
}

/**
 * Assign A/B/C labels by exact rhyme key. Lines whose final word is unknown get
 * `null` rather than a wrong label — a bad label is worse than no label, because
 * you would trust it.
 */
export function schemeOf(lines: string[]): RhymeScheme {
  const analyses = lines.map(analyzeLine);
  const seen = new Map<string, string>();
  const labels: (string | null)[] = [];
  let next = 0;
  for (const a of analyses) {
    if (!a.rhymeKey) {
      labels.push(null);
      continue;
    }
    let label = seen.get(a.rhymeKey);
    if (!label) {
      label = LABELS[next % LABELS.length] as string;
      if (next >= LABELS.length) label += String(Math.floor(next / LABELS.length));
      next++;
      seen.set(a.rhymeKey, label);
    }
    labels.push(label);
  }
  return {
    labels,
    keys: analyses.map((a) => a.rhymeKey),
    counts: analyses.map((a) => a.count),
  };
}

/**
 * 0..1 similarity between two rhyme keys, counting shared phonemes from the end.
 * 1.0 is a perfect rhyme; 0.5-0.99 is the slant-rhyme band worth surfacing.
 */
export function rhymeScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const pa = a.split(' ');
  const pb = b.split(' ');
  let shared = 0;
  while (
    shared < pa.length &&
    shared < pb.length &&
    pa[pa.length - 1 - shared] === pb[pb.length - 1 - shared]
  ) {
    shared++;
  }
  return shared / Math.max(pa.length, pb.length);
}
