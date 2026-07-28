import { Chord, Interval, Note } from 'tonal';

/**
 * Letter-name <-> Nashville Number System conversion. Pure, client-side only
 * — the server always stores and sends letter-name chord symbols (see
 * `songs.chord_display`); this module is a display transformation computed
 * at render time and never fed back into a write.
 *
 * ## The convention
 *
 * Degrees are relative to the **major scale built on the song's tonic**,
 * whether the key itself is major or minor. That keeps the tonic at `1`
 * always, and sidesteps the relative-vs-parallel-minor ambiguity that other
 * Nashville conventions run into.
 *
 * - A non-diatonic root (one that isn't a note of that major scale) takes a
 *   `b` or `#` prefix: `b7`, `#4`.
 * - Diatonic quality is implied, not written: in C major, `Dm` is `2`, not
 *   `2m` — that's what makes a chart readable at a glance.
 * - Quality is written only when the chord deviates from the diatonic
 *   quality for that degree (`D` in C major, a major chord where minor is
 *   diatonic, is `2maj`; `Fm` is `4m`). A degree with an accidental prefix
 *   has no diatonic quality to imply, so its quality is always written the
 *   normal way (nothing for major, `m` for minor): `b7`, `b3m`.
 * - Extensions and alterations carry through verbatim after the degree:
 *   `Cmaj7` in C is `1maj7`; `G7` is `57`; `Dsus4` is `2sus4`.
 * - A slash chord numbers both halves, but the two halves use different
 *   reference tonics: the root is numbered against the *song key*, the bass
 *   against the *chord's own root* — the bass number is which inversion
 *   it is, independent of key. `C/G` in C is `1/5`; `F/A` in C is `4/3`
 *   (A is the third of F, not the sixth of C).
 * - A symbol tonal can't parse renders unchanged, letter name and all.
 *   Never a wrong number, never blank.
 *
 * ## All seven diatonic degrees
 *
 * C major (reference scale = C major itself, so every diatonic chord is a
 * bare digit):
 *
 * | Chord | Number |
 * |-------|--------|
 * | C     | 1      |
 * | Dm    | 2      |
 * | Em    | 3      |
 * | F     | 4      |
 * | G     | 5      |
 * | Am    | 6      |
 * | Bdim  | 7      |
 *
 * A minor (reference scale is still a *major* scale — A major: A B C# D E
 * F# G# — so the natural-minor triads land on accidental degrees):
 *
 * | Chord | Number |
 * |-------|--------|
 * | Am    | 1m     |
 * | Bdim  | 2dim   |
 * | C     | b3     |
 * | Dm    | 4m     |
 * | Em    | 5m     |
 * | F     | b6     |
 * | G     | b7     |
 */

type Quality = 'major' | 'minor' | 'diminished' | 'augmented';

/** Diatonic triad quality by scale degree (1-indexed), for the major-scale reference. */
const DIATONIC_QUALITY: Quality[] = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished'];

/** Semitone offset of each major-scale degree (1-indexed) from its tonic. */
const MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

/** Nashville degree label for each semitone offset (0-11) from a reference tonic. */
const OFFSET_LABELS = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];

const KEY_RE = /^([A-G][#b]?)m?$/;

function parseTonic(key: string): string | null {
  const m = KEY_RE.exec(key.trim());
  return m ? (m[1] as string) : null;
}

interface DegreeLabel {
  label: string;
  accidental: '' | 'b' | '#';
  digit: number;
}

function degreeLabelFor(note: string, referenceTonic: string): DegreeLabel {
  const noteChroma = Note.chroma(note) ?? 0;
  const tonicChroma = Note.chroma(referenceTonic) ?? 0;
  const offset = (((noteChroma - tonicChroma) % 12) + 12) % 12;
  const label = OFFSET_LABELS[offset] as string;
  const accidental = label.startsWith('b') ? 'b' : label.startsWith('#') ? '#' : '';
  const digit = Number(accidental ? label.slice(1) : label);
  return { label, accidental, digit };
}

function noteForDegree(referenceTonic: string, digit: number, accidental: '' | 'b' | '#'): string {
  let offset = MAJOR_SCALE_OFFSETS[digit - 1] as number;
  if (accidental === 'b') offset -= 1;
  else if (accidental === '#') offset += 1;
  offset = ((offset % 12) + 12) % 12;
  return Note.transpose(referenceTonic, Interval.fromSemitones(offset));
}

/** Classifies a letter-name chord's quality-bearing marker: minor `m` (not `maj`), `dim`/`°`, `aug`/`+`, or bare major. */
function classifyQuality(suffix: string): { quality: Quality; markerLength: number } {
  if (suffix.startsWith('°')) return { quality: 'diminished', markerLength: 1 };
  if (/^dim/.test(suffix)) return { quality: 'diminished', markerLength: 3 };
  if (suffix.startsWith('+')) return { quality: 'augmented', markerLength: 1 };
  if (/^aug/.test(suffix)) return { quality: 'augmented', markerLength: 3 };
  if (/^m(?!aj)/.test(suffix)) return { quality: 'minor', markerLength: 1 };
  return { quality: 'major', markerLength: 0 };
}

const CHORD_RE = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;

function parseChordSymbol(symbol: string): { root: string; suffix: string; bass: string | null } | null {
  const m = CHORD_RE.exec(symbol);
  if (!m) return null;
  const chord = Chord.get(symbol);
  if (chord.empty || chord.notes.length === 0) return null;
  return { root: m[1] as string, suffix: (m[2] as string) ?? '', bass: m[3] ?? null };
}

/** Letter-name chord symbol -> Nashville number, relative to `key`'s tonic. Unparseable input passes through unchanged. */
export function toNumber(symbol: string, key: string): string {
  const trimmed = symbol.trim();
  const tonic = parseTonic(key);
  if (!tonic) return symbol;
  const parsed = parseChordSymbol(trimmed);
  if (!parsed) return symbol;

  const rootLabel = degreeLabelFor(parsed.root, tonic);
  const impliedQuality: Quality = rootLabel.accidental ? 'major' : (DIATONIC_QUALITY[rootLabel.digit - 1] as Quality);
  const { quality: actualQuality, markerLength } = classifyQuality(parsed.suffix);

  let outSuffix: string;
  if (actualQuality === impliedQuality) {
    // Matches the degree's implied quality: major needs no marker (it never
    // carries one); minor/dim/aug drop the marker that would otherwise imply it.
    outSuffix = actualQuality === 'major' ? parsed.suffix : parsed.suffix.slice(markerLength);
  } else if (actualQuality !== 'major') {
    // An explicit minor/dim/aug chord always keeps its own marker, whatever
    // the degree implies.
    outSuffix = parsed.suffix;
  } else {
    // Major where something else is implied. Only a bare triad can carry an
    // unambiguous override ("maj"); a chord with its own extension (7, sus4,
    // maj7…) already reads as major-rooted on its own, and prefixing "maj"
    // onto it would misname the chord (e.g. turning a dominant 7 into a
    // major 7), so it's left verbatim instead.
    outSuffix = parsed.suffix === '' ? 'maj' : parsed.suffix;
  }

  let out = rootLabel.label + outSuffix;
  if (parsed.bass) {
    // The bass half numbers against the chord's own root, not the song key —
    // it names the inversion (which chord tone is in the bass), not a scale position.
    out += '/' + degreeLabelFor(parsed.bass, parsed.root).label;
  }
  return out;
}

const NUMBER_RE = /^([b#]?)([1-7])([a-zA-Z0-9°+]*)(?:\/([b#]?)([1-7]))?$/;

/** Nashville number -> letter-name chord symbol, relative to `key`'s tonic. Returns null for input that isn't a valid number-chart symbol. */
export function fromNumber(input: string, key: string): string | null {
  const tonic = parseTonic(key);
  if (!tonic) return null;
  const trimmed = input.trim();
  const m = NUMBER_RE.exec(trimmed);
  if (!m) return null;

  const [, acc, digitStr, suffix, bassAcc, bassDigitStr] = m;
  const accidental = (acc as '' | 'b' | '#') ?? '';
  const digit = Number(digitStr);
  const rootNote = noteForDegree(tonic, digit, accidental);
  const impliedQuality: Quality = accidental ? 'major' : (DIATONIC_QUALITY[digit - 1] as Quality);

  let finalSuffix: string;
  if (suffix === 'maj') {
    // The explicit override marker toNumber writes for a bare major chord
    // on a degree that implies something else — consumed, not carried through.
    finalSuffix = '';
  } else if (suffix === '') {
    finalSuffix = impliedQuality === 'major' ? '' : impliedQuality === 'minor' ? 'm' : impliedQuality === 'diminished' ? 'dim' : 'aug';
  } else {
    // A written marker (m7, dim…) or a bare extension (7, sus4, maj7…) —
    // either way it already says what it means, verbatim.
    finalSuffix = suffix as string;
  }

  let out = rootNote + finalSuffix;
  if (bassDigitStr) {
    out += '/' + noteForDegree(rootNote, Number(bassDigitStr), (bassAcc as '' | 'b' | '#') ?? '');
  }

  const chord = Chord.get(out);
  if (chord.empty || chord.notes.length === 0) return null;
  return out;
}

/**
 * What a chord chip should show, given the song's display setting. Numbers
 * mode falls back to the letter name with no key to convert against — the
 * toggle itself is disabled in that case, so this is a defensive fallback,
 * not a path the UI is expected to exercise.
 */
export function displaySymbol(symbol: string, chordDisplay: string, songKey: string | null): string {
  if (chordDisplay !== 'numbers' || !songKey) return symbol;
  return toNumber(symbol, songKey);
}
