# Architecture

This is for someone changing the code. `README.md` is the user- and
operator-facing document — install, run, the editor, the API, migrations from
an operator's point of view. This file assumes you've read that and describes
how the pieces fit together.

## The layering rule

Dependencies flow one way: **routes/ → music/ / export/ / prosody/ → db.ts**.
A route module may import from `music/`, `export/`, `prosody/`, or `db.ts`.
It may never import from another module inside `routes/`.

That rule is what this refactor exists to restore. Before it, the graph had
gone sideways:

```
src/routes/timing.ts:6  import { songIdOfLine } from './lines'
src/routes/export.ts:3  import { buildGrid }    from './timing'
```

`buildGrid` — the most important function in the app, since both playback and
MIDI export consume it — lived inside a route module, so following how a
voicing reaches the client meant hopping sideways from `export.ts` into
`timing.ts` instead of down into a layer. It now lives in `src/music/grid.ts`;
`songIdOfLine`/`songIdOfSection` moved to `db.ts` next to `touchSong` and
`midpoint`, the same kind of helper. No route module imports from another
route module.

## Where do I change X?

| I want to... | Look at |
|---|---|
| Add or change an API endpoint | The matching file in `src/routes/` (register a new file in `src/index.ts`) |
| Change how syllables are counted or stressed | `src/prosody/syllables.ts` (dictionary lookup in `src/prosody/cmudict.ts`) |
| Change how rhyme letters/scores are assigned | `src/prosody/rhyme.ts` |
| Change how sparse anchors interpolate to bar/beat | `src/music/resolve.ts` |
| Change which syllable a chord lands on | `src/music/leadsheet.ts` |
| Change how chords are voiced (inversions, register, slash basses) | `src/music/voiceLeading.ts` |
| Change what the grid response combines or contains | `src/music/grid.ts` (`buildGrid`) |
| Change the ChordPro export/import format | `src/export/chordpro.ts` |
| Change the exported MIDI file | `src/export/midi.ts` |
| Add a column or table | `src/schema.sql` **and** a new `src/migrations/00N-*.sql` — see [Migrations](#migrations) |
| Change request/response validation or shapes | `src/types.ts` (zod schemas + row types) |
| Change auth, static file serving, or route registration | `src/index.ts` |
| Change what a printed leadsheet looks like | `web/src/components/PrintSheet.tsx` (styles gated under `@media print` in `web/src/styles.css`) |
| Change the lyric sheet, gutter, or rhyme UI | `web/src/components/Sheet.tsx`, `Scansion.tsx`, `LineRow.tsx` |
| Change the bar ruler or chord-slot UI | `web/src/components/BarRuler.tsx` |
| Change autosave, reload, or any song/line/chord mutation | `web/src/hooks/useSong.ts` |
| Change playback scheduling or the metronome | `web/src/audio/metronome.ts`, `web/src/components/Transport.tsx` |
| Change client-side chord validation, diatonic suggestions, or transpose math | `web/src/chords.ts` |

## One request, traced end to end

A chord edit is the path with the most indirection — it touches every layer
and both playback and MIDI export consume the result — so it's the one worth
spelling out.

1. **Client.** Dragging a chord chip to a new slot calls `onMoveChord` from
   `web/src/hooks/useSong.ts`, which calls `api.moveChord()`
   (`web/src/api.ts`) — a `PATCH /api/chords/:id`.
2. **Route.** `src/routes/chords.ts` validates the body against
   `ChordPatch` (`src/types.ts`), checks the target slot isn't occupied
   (unless `replace`), and writes the new `bar`/`beat` straight to the
   `chords` table. Nothing about timing or voicing happens here — chords
   are keyed to `(song_id, bar, beat)`, not to a line.
3. **Reload.** `useSong`'s mutation helpers all call `reload()` after a
   write, which fetches `GET /api/songs/:id` and `GET /api/songs/:id/grid`
   together.
4. **Grid build.** `src/routes/timing.ts`'s grid handler calls `buildGrid()`
   in `src/music/grid.ts`. For every line with a `line_timing` row, it calls
   `resolveLineTiming()` (`src/music/resolve.ts`) to turn that line's sparse
   syllable anchors into an absolute bar/beat per syllable. It then calls
   `placeChords()` (`src/music/leadsheet.ts`) to find, for every chord in the
   song (including the one that just moved), the nearest syllable at or after
   its bar/beat. Finally it calls `resolveVoicings()`
   (`src/music/voiceLeading.ts`) once over the whole chord sequence in
   bar/beat order, since voice leading looks at each chord's predecessor.
5. **Response.** The client re-renders `Sheet` from the new `grid.chords` —
   the moved chord's inline position (or its fallback slot on the bar ruler,
   if it landed on no syllable) comes straight from `placeChords()`'s output.
6. **Playback and export consume the same grid.** `Transport`
   (`web/src/components/Transport.tsx`) schedules the metronome and chord
   voice from `grid.chords[].voicing` — the exact MIDI notes `buildGrid`
   computed. `GET /api/songs/:id/export.mid` and
   `GET /api/songs/:id/export.chordpro` (`src/routes/export.ts`) call
   `buildGrid()` again for the same song and feed its output to
   `src/export/midi.ts` / `src/export/chordpro.ts`. Because playback, MIDI
   export, and ChordPro export all go through the one `buildGrid()` call,
   the moved chord sounds and prints identically everywhere the moment the
   grid refetch lands — there's no second place that could compute it
   differently.

## Module responsibilities

**`src/routes/`** — Fastify handlers. Parse and validate the request, read or
write the database, shape the response. No business logic that isn't a direct
translation of an HTTP verb into a query.

- `songs.ts` — song and section CRUD, revision snapshots/restore
- `lines.ts` — line CRUD, section/line reordering (`position` midpoints)
- `timing.ts` — line timing anchors (`PUT`/`DELETE`), `GET .../grid`
- `chords.ts` — chord CRUD, the atomic transpose write
- `prosody.ts` — `/api/prosody/*` — analyze, word lookup, rhymes, status
- `export.ts` — ChordPro export/import, MIDI export

**`src/music/`** — pure functions, no database or Fastify imports. Harmony
and timing math that routes and exports both depend on.

- `resolve.ts` — sparse syllable anchors → absolute bar/beat per syllable
- `leadsheet.ts` — chord sequence + resolved syllables → which syllable (if
  any) each chord lands on
- `voiceLeading.ts` — chord symbols → MIDI note arrays (inversions, register
  clamping, slash-bass pinning)
- `grid.ts` — `buildGrid()`, the one place that reads the database and
  composes the three modules above into the `Grid` shape routes and export
  both return

**`src/export/`** — pure serialization, no database or Fastify imports.

- `chordpro.ts` — ChordPro serialize/parse (round-trips byte-identically)
- `midi.ts` — hand-rolled Type-0 Standard MIDI File writer

**`src/prosody/`** — pure analysis over the vendored CMU dictionary.

- `cmudict.ts` — parses `data/cmudict-0.7b.txt`
- `syllables.ts` — per-word/line syllable count, stress, boundaries
- `rhyme.ts` — rhyme-scheme letter/score assignment across a set of lines

**`src/db.ts`** — the `node:sqlite` connection, startup migration runner,
and the handful of query helpers shared across route modules (`touchSong`,
`midpoint`, `songIdOfSection`, `songIdOfLine`).

**`src/types.ts`** — zod request/response schemas and row types shared by
`routes/`.

**`src/index.ts`** — Fastify app setup: the bearer-token hook, error
handler, route registration, and static file serving for the built client.

**`web/src/`**

- `App.tsx` — the three-column shell, routing between the empty and loaded
  states, the error banner, and the token gate
- `hooks/useSong.ts` — loaded song/grid state, the debounced per-line
  autosave, and every mutation (section/line/chord/timing/transpose/import)
- `api.ts` — the typed fetch client and shared response types
- `chords.ts` — client-side chord validation, diatonic suggestions, and
  transpose math (via `tonal`) — the server writes whatever symbols the
  client already computed
- `components/` — `Sheet` (lyric sheet + gutter), `LineRow`, `Scansion`,
  `BarRuler`, `Inspector` (alternates/rhymes/history), `TempoControl`,
  `TransposeControl`, `Transport`, `ExportControls`, `PrintSheet`
- `audio/metronome.ts` — Web Audio lookahead scheduling for playback

## The data model, briefly

Three independent layers sit over one bar/beat grid: lyrics (`sections` →
`lines`), timing (`line_timing`, one sparse row per placed line), and chords
(`chords`, keyed to `(song_id, bar, beat)`). A `lines` row is valid with no
timing and no chords — that's why `line_timing` is a separate table with a
nullable relationship to `lines`, not columns on it.

Anchors are sparse: `line_timing.syllable_offsets_json` only needs the
syllables actually pinned by hand; `src/music/resolve.ts` interpolates
everything between and after. Chords key off `(song_id, bar, beat)` rather
than off a line, so rewriting a lyric never disturbs the progression, and a
chord can exist in a bar with no timed line at all (it just renders unplaced,
on the bar ruler rather than inline).

See README.md's ["Timing and the grid"](README.md#timing-and-the-grid),
["Chords"](README.md#chords), and ["Known behaviour"](README.md#known-behaviour-so-it-doesnt-surprise-you-later)
sections for the fuller reasoning and the syllable-counting caveats — this
section only covers the shape, not the why.

## Migrations

`src/schema.sql` is `CREATE TABLE IF NOT EXISTS` throughout, so running it
against an existing database is a no-op — it only ever creates a table that
isn't there yet. That means it **never alters** an existing database; it
only describes what a fresh one looks like.

Anything added after the fact is a numbered file in `src/migrations/`,
applied in order by the startup runner in `src/db.ts` against any database
whose `PRAGMA user_version` is below that file's version. `002-voice-leading.sql`
has already been applied to the production database — **do not edit it**.
Editing an already-applied migration changes nothing for databases that
already ran it, silently diverging schema.sql/migrations from what
production actually has.

To add a schema change:

1. Update `src/schema.sql` to the new shape, so a fresh database gets it
   directly.
2. Add `src/migrations/003-<name>.sql` with the `ALTER`/`CREATE` needed to
   bring an existing database up to that same shape.
3. Register it in the `MIGRATIONS` array in `src/db.ts` with `version: 3`.

A brand-new database skips the migration file entirely (schema.sql already
has it) and jumps straight to the latest version number; an existing
database applies every migration numbered above its current version, in
order, committing the version after each.
