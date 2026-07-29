# songsmith

Self-hosted, lyric-first songwriting app. Songs are lyrics first: sections,
lines, alternates, revisions, offline prosody (syllable counts, stress, rhyme
scheme, rhyme suggestions). On top of that, a sparse timing layer maps
syllables onto a bar/beat grid, a chord layer places leadsheet symbols on that
same grid, and a voice-leading engine turns those symbols into the actual
notes played and exported — all editable from a single React editor.

Runs with **four runtime dependencies** (`fastify`, `@fastify/static`, `zod`,
`tonal`) — 100 packages in the resolved production tree. There is no native
module and no build toolchain, because storage uses Node's built-in
`node:sqlite` rather than `better-sqlite3`.

This is the user- and operator-facing doc — install, run, the editor, the
API. If you're changing the code, see [ARCHITECTURE.md](ARCHITECTURE.md) for
the module layout and how a change should move through the codebase.

---

## Run it

```bash
npm install
npm run build:all          # builds web/ into public/, then the server
node --experimental-sqlite dist/index.js
```

Open `http://localhost:5180`.

Two-process dev loop, if you want hot reload on the UI:

```bash
npm run dev                # server on :5180, TypeScript run directly
npm --prefix web run dev   # Vite on :5173, proxies /api to :5180
```

Then:

```bash
curl localhost:5180/healthz
curl -X POST localhost:5180/api/songs \
  -H 'content-type: application/json' \
  -d '{"title":"Leave The Light On","song_key":"Am"}'
```

Dev mode with reload (`npm run dev`) uses `--experimental-strip-types`, so it
runs the TypeScript directly with no build step.

## Docker

```bash
cp .env.example .env
openssl rand -hex 32   # paste into SONGSMITH_TOKEN
docker compose up -d --build
```

The container binds to `127.0.0.1:5180` only. Point Nginx Proxy Manager at that
address the same way as your other services. The SQLite file lives in `./data`
on the host, so `docker compose build` never touches your songs.

### Running the published image (no clone required)

To run Songsmith on a server without checking out this repo, grab
[`docker-compose.prod.yml`](docker-compose.prod.yml) and `.env.example`, put
them in their own directory, and start it from the published multi-arch
(amd64/arm64) image:

```bash
mkdir songsmith && cd songsmith
curl -O https://raw.githubusercontent.com/therebelrobot/songsmith/main/docker-compose.prod.yml
curl -O https://raw.githubusercontent.com/therebelrobot/songsmith/main/.env.example
mv .env.example .env
openssl rand -hex 32   # paste into SONGSMITH_TOKEN in .env

docker compose -f docker-compose.prod.yml up -d
```

`./data` (the SQLite database) and `.env` are created next to the compose
file, so the whole deployment — compose file, env, and data — lives in one
directory you can back up or move as a unit. Pin a specific release instead
of `latest` by editing the `image:` tag to e.g.
`ghcr.io/therebelrobot/songsmith:v0.1.0`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5180` | listen port |
| `HOST` | `0.0.0.0` | listen address |
| `SONGSMITH_DB` | `./data/songsmith.db` | database file |
| `SONGSMITH_TOKEN` | *(unset)* | when set, `/api/*` requires `Authorization: Bearer <token>`. Unset means open — fine on the LAN, not fine through the proxy. |
| `SONGSMITH_CMUDICT` | `./data/cmudict-0.7b.txt` | dictionary path |
| `LOG_LEVEL` | `info` | pino level |

`/healthz` is never authenticated, so the compose healthcheck works with a token set.

---

## The editor

Three columns: songs on the left, the lyric sheet in the middle, an inspector on
the right.

**The scansion gutter** is the thing worth explaining. Every line carries a
stress sparkline in the left margin — one mark per syllable, tall for primary
stress, half-height for secondary, a low tick for unstressed. Two verses that
scan the same produce the same silhouette, so a metre problem is visible without
counting anything. The number beside it is the syllable count; it turns amber
when any word in the line was estimated rather than found in the dictionary.

The rhyme letter sits on the right edge in rose. A dot means the last word isn't
in the dictionary, so no label was guessed.

Selecting a line reveals its syllable segmentation underneath in monospace
(`ne·ver  meant  to`), with primary-stressed syllables in mint.

**Keys and gestures**

| Action | How |
|---|---|
| New line below | `Enter` in a line |
| Line break inside a line | `Shift+Enter` |
| Delete an empty line | `Backspace` in an empty line |
| Reorder a line | drag a line onto another |
| Place a line on the bar grid | drag a line onto the bar ruler, or type a bar/beat directly |
| Pin a syllable to its current beat | click the syllable in the segmentation view |
| Add/move/delete a chord | click an empty beat slot on the chord track, drag a chord chip to a new slot, click its `×` |

**Alternates** are in the inspector. "Stash this wording" moves the current text
into the alternates list and clears the line so you can try again; "Use this"
swaps a stashed version back in. Nothing is destroyed unless you discard it.

**Rhymes** prefills with the last word of the selected line. Slant mode drops the
threshold to 0.5 and shows the match score.

**History** snapshots the whole song. Restoring snapshots the current state
first, so a restore is itself undoable.

**Tempo, meter, and the bar grid.** The song header has a bpm field (type a
number, or tap a button a few times to set it by feel) and a meter fraction.
Selecting a line reveals a bar/beat field and a "drag onto the bar ruler, or
pin a syllable" hint — syllable anchors are sparse (see below), so most of a
line's timing comes from interpolation, not from placing every syllable by
hand.

**Chords** live on the bar ruler, one slot per beat, sized from each section's
bar count and meter. Click an empty slot to add a symbol (tonal validates it as
you type, with diatonic suggestions drawn from the song's key), click an
existing chord to rename it, drag it to a different slot, or click its `×` to
remove it. Chords key off the bar grid, not off lines, so rewriting a lyric
never disturbs the progression. The same chord also renders inline, right
before the syllable it lands on.

**Transpose** shifts every chord symbol and the song key by a semitone at a
time, using tonal so the result gets a conventional spelling (`Am` up a
semitone is `Bbm`, not `A#m`).

**Voice leading** is on by default: chords are voiced with inversions chosen to
minimize movement from the previous chord, register-clamped to a three-octave
window from C3 to C6. The checkbox in the song header (next to the
save-state indicator) turns it off per song, falling back to blocked
root-position chords — root in one octave, everything else stacked in the
next octave up, no inversions. This one toggle is the entire UI surface for
voice leading; the actual voicing is computed once, server-side, and both
playback and MIDI export play exactly what it returns.

**Playback** plays the resolved chord track through the Web Audio API — a
lookahead-scheduled metronome click plus a polyphonic chord voice at each
chord's bar/beat, using whichever notes the grid returned. "from bar" starts
playback partway through the song.

**Export, import, print** live in one small popover in the song header:
`.chordpro` and `.mid` downloads, a ChordPro import that always creates a new
song (never overwrites one you have open), and a print view — a plain
leadsheet (chord symbols aligned above the lyric they land on), shown only
under `@media print`, with no rails, buttons, or gutter.

The UI uses no web fonts — it runs on a Pi that may have no internet, so
typography is a deliberate system stack: monospace for the lyric sheet (so
syllable marks align vertically), system sans for chrome.

---

## API

### Songs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/songs` | list, newest-updated first |
| `POST` | `/api/songs` | creates the song **and** a `Verse 1` section |
| `GET` | `/api/songs/:id` | full tree: sections → lines → syllables, alternates, rhyme labels |
| `PATCH` | `/api/songs/:id` | any of title, song_key, tempo_bpm, meter_num, meter_den, notes, voice_leading |
| `DELETE` | `/api/songs/:id` | cascades to sections, lines, chords, revisions |

### Sections

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/songs/:id/sections` | `{ name, after_id?, bar_count? }` |
| `PATCH` | `/api/sections/:id` | `{ name?, bar_count?, after_id?, before_id? }` |
| `DELETE` | `/api/sections/:id` | |

### Lines

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/sections/:id/lines` | `{ text, after_id? }` |
| `PATCH` | `/api/lines/:id` | `{ text?, alternates?, after_id?, before_id? }` |
| `POST` | `/api/lines/:id/promote` | `{ index }` — swaps live text with `alternates[index]`; the old text becomes the alternate. Nothing is destroyed. |
| `DELETE` | `/api/lines/:id` | |

Reordering uses `after_id` / `before_id` and a REAL `position` column. A move is
one UPDATE of one row — no renumbering pass, which is what makes drag-reorder
cheap when the UI lands.

### Timing and the grid

| Method | Path | Notes |
|---|---|---|
| `PUT` | `/api/lines/:id/timing` | `{ start_bar, start_beat?, syllable_offsets? }` — sparse anchors: `syllable_offsets` only needs the syllables you actually pin; everything between and after is interpolated |
| `DELETE` | `/api/lines/:id/timing` | unplaces the line |
| `GET` | `/api/songs/:id/grid` | the resolved timeline: every timed line's syllables at absolute bar/beat, every chord placed and voiced. The editor, ChordPro export, and MIDI export all render from this — none of them recompute the timing or voicing math themselves |

`syllable_offsets` are sixteenth-note offsets from a line's own start, indexed
by syllable ordinal — not by absolute time — so moving a line's start bar
doesn't require rewriting every anchor.

### Chords

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/songs/:id/chords` | `{ bar, beat?, symbol, duration_beats?, replace? }` — 409s with the occupant if the slot is taken and `replace` isn't set |
| `PATCH` | `/api/chords/:id` | `{ bar?, beat?, symbol?, duration_beats?, replace? }` |
| `DELETE` | `/api/chords/:id` | |
| `POST` | `/api/songs/:id/transpose` | `{ song_key?, chords: [{ id, symbol }] }` — atomic write for symbols the **client** already computed with tonal; the server never transposes on its own, so there's one transposition implementation, not two |

Chords are keyed to `(song_id, bar, beat)`, never to a line — rewriting a
lyric leaves the progression untouched.

### Revisions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/songs/:id/revisions` | |
| `POST` | `/api/songs/:id/revisions` | `{ label }` — snapshots the whole tree |
| `POST` | `/api/revisions/:id/restore` | auto-snapshots current state first, so restore is undoable |

### Prosody

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/prosody/analyze` | `{ lines: string[] }` → per-line syllables, stress, rhyme labels |
| `GET` | `/api/prosody/word/:word` | single-word breakdown plus raw ARPAbet |
| `GET` | `/api/prosody/rhymes?word=&limit=&min_score=` | `min_score=1` is perfect rhymes; `0.5`–`0.9` opens the slant band |
| `GET` | `/api/prosody/status` | entry count and dictionary provenance |

---

### Export / import

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/songs/:id/export.chordpro` | `text/plain`, chords inline as `[Am]` before the syllable they land on; a chord with no syllable renders as its own chord-only line |
| `POST` | `/api/import/chordpro` | `{ text }` — creates a **new** song, never overwrites an existing one; response includes `warnings` (e.g. no `{tempo}`/`{time}` found, defaulted to 4/4) |
| `GET` | `/api/songs/:id/export.mid` | `audio/midi`, Type-0, chord track only, voiced the same way the song's `voice_leading` toggle voices playback — inverted and register-clamped when the toggle is on, blocked root-position when it's off. A null tempo defaults to 120 and is flagged via the `x-songsmith-default-tempo` response header rather than failing |

ChordPro is the round-trip format: export → import → export is byte-identical
(see `src/export/chordpro.test.ts`). MIDI export, ChordPro serialization, and
the grid endpoint are all fed by `buildGrid()` in `src/routes/timing.ts` and
`resolveVoicings()` in `src/timing/voiceLeading.ts` — pure functions with no
database or Fastify imports — so none of playback, export, or the on-screen
grid can drift from each other.

## Voice leading

`src/timing/voiceLeading.ts` turns a chord sequence into MIDI note arrays:

- For each chord, it generates candidates — root position plus every
  inversion — across the octave shifts that keep every note between MIDI 48
  (C3) and 84 (C6).
- Each candidate is scored by total voice motion from the previous chord's
  chosen voicing (the sum of each new note's distance to its nearest note in
  the prior voicing). The lowest score wins; ties break on the lowest bass
  note, so the same song always voices the same way.
- A repeated chord symbol reuses its predecessor's voicing exactly — zero
  motion, rather than re-deriving an identical result.
- A slash chord (`C/G`) pins the named bass regardless of what would otherwise
  score best.
- The first chord in a sequence has no predecessor, so it seeds in root
  position near the middle of the register window.

This is deliberately not jazz voicing — no drop-2, no rootless voicings, no
upper-structure triads, no bass-line or melody generation, no rhythm pattern.
Chords still sound as block hits; output is still a leadsheet, not tab or
engraved notation. `@tonaljs/voice-leading` and `@tonaljs/voicing` (tonal's own
voice-leading and jazz-voicing packages) were checked before writing this —
the former only compares a candidate's top note to the previous voicing's top
note, and the latter is a dictionary-driven jazz-voicing builder aimed at
exactly the drop-2/rootless/upper-structure territory this app avoids. Neither
fits the scoring above, so the search is hand-rolled on top of tonal's pitch
math (`Chord.get`, `Note.chroma`, `Note.midi`) instead.

Voicing is always derived from the chord sequence, never stored — the
`chords` table stays `(song_id, bar, beat, symbol, duration_beats)`, so editing,
inserting, or transposing a chord can't leave a stale voicing behind.

## Migrations

`src/schema.sql` is `CREATE TABLE IF NOT EXISTS` throughout, so it never alters
an existing database — a fresh one just gets every table at its current shape.
Anything added after the fact (so far: `songs.voice_leading`) is a numbered file
in `src/migrations/`. On startup, `src/db.ts`:

1. Checks whether the `songs` table exists yet, *before* running `schema.sql`
   — that's what tells a brand-new database apart from an old one, since both
   would otherwise read `PRAGMA user_version` as `0`.
2. Runs `schema.sql` (a no-op against an existing database).
3. A brand-new database jumps straight to the latest migration's version
   number, since `schema.sql` already created everything at that shape. An
   existing one applies every migration numbered above its current
   `user_version`, in order, committing the version after each.

## Testing & CI

`node --test` covers the pure modules (`src/timing/*`, `src/export/*`,
`src/prosody/*`) and the migration runner against both a fresh database and one
seeded with a pre-migration schema. `.github/workflows/ci.yml` runs both
typechecks, both builds, and the test suite on every push and pull request.

`npm --prefix web run smoke` renders the sheet and inspector against a running
server and asserts the gutter, rhyme tabs, segmentation, and empty states
appear — it catches crashes, not visual regressions, and is not part of CI.

## Known behaviour, so it doesn't surprise you later

**Syllable counts are careful-speech counts.** CMU has `EVERY` as three
syllables (`EH1 V ER0 IY0`), so "counting every hour that you were gone" scores
11 even though you'd sing it as 9. The dictionary is right about the word and
wrong about the performance. Beat anchoring is where you reconcile that — pin
the syllables you actually sing and let the rest collapse.

**Syllable boundaries are heuristic; counts are authoritative.** The count comes
from the dictionary's phonemes. The orthographic split into "kett·le" is a
rule-based guess that sometimes lands oddly ("kitc·hen"). Treat boundaries as a
draggable default in the UI, not as truth.

**Unknown words fall back to an estimator.** Songwriting produces proper nouns,
slang, and made-up words constantly. Those get `known: false`, a
letter-pattern syllable estimate, and `rhymeKey: null` — so they are excluded
from rhyme labelling rather than mislabelled. A wrong rhyme label is worse than
a missing one because you'd trust it.

**Rhyme suggestions are English-only.** CMU is an English dictionary. There is
no French, Spanish, or anything else. Adding another language means adding
another dictionary and a per-song language field.

**The rhyme index costs ~700 ms on first use** (measured on x86; estimate
2–3.5 s on a Pi 4, unverified) and about 45 MB resident. It builds lazily on the
first `/api/prosody/*` call, so boot stays fast. Perfect-rhyme lookups after
that are 7–8 ms; slant scans are 59–94 ms, which is why slant rhymes belong on
an explicit button rather than a keystroke debounce.

**Voice leading is on by default, per song.** Turning it off doesn't lose
anything — it's a display/playback choice recomputed from the same chord
sequence every time, not a stored property of the chords themselves.

**No audio synthesis happens on the server.** It computes note numbers and
writes MIDI bytes; both playback and MIDI decoding/rendering are the browser's
(or your DAW's) job.

---

## Provenance

- `data/cmudict-0.7b.txt` — CMU Pronouncing Dictionary, BSD-2-Clause, vendored
  directly in the repo (with its license at `data/CMUDICT-LICENSE.txt`)
  rather than fetched on install. `cmusphinx/cmudict` has no release
  cadence — two fetches of `master` on different days can return different
  entry counts — and since syllable counts, stress, and rhyme keys all derive
  from this file, a silent refetch could quietly change a line's scansion or
  drop a rhyme label on a song someone already wrote against the old data.
  Vendoring pins it and makes the build work with no network access, which
  matters for a Pi. Parsed ourselves rather than via the `cmudict` npm
  package, which was last published in 2012, ships no types, and parses the
  3.6 MB file byte-by-byte with string concatenation.
- `tonal` — the one dependency added past the original three, deliberately an
  exception to the standing budget because it *removes* code rather than
  adding it: the server used to keep a hand-rolled chord/note table in sync
  with the tonal the client already used, verified once by hand with nothing
  re-checking it. It resolves to 29 first-party `@tonaljs/*` packages with no
  third-party transitive dependencies, used for pitch math only
  (`Chord.get`, `Note.chroma`, `Note.midi`) — the voice-leading search itself
  is hand-rolled (see "Voice leading" above).
- Project code: Unlicense.
