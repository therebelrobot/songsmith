# songsmith — phase 1 (lyric core)

Self-hosted, lyric-first songwriting app. Phase 1 is the lyric core: songs,
sections, lines, alternates, revisions, offline prosody (syllable counts,
stress, rhyme scheme, rhyme suggestions), and a React editor. No audio yet —
that's phase 2.

Everything here runs with **three runtime dependencies** (`fastify`,
`@fastify/static`, `zod`) — 71 packages in the resolved tree. There is no native
module and no build toolchain, because storage uses Node's built-in
`node:sqlite` rather than `better-sqlite3`.

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
| Reorder | drag a line onto another |

**Alternates** are in the inspector. "Stash this wording" moves the current text
into the alternates list and clears the line so you can try again; "Use this"
swaps a stashed version back in. Nothing is destroyed unless you discard it.

**Rhymes** prefills with the last word of the selected line. Slant mode drops the
threshold to 0.5 and shows the match score.

**History** snapshots the whole song. Restoring snapshots the current state
first, so a restore is itself undoable.

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
| `PATCH` | `/api/songs/:id` | any of title, song_key, tempo_bpm, meter_num, meter_den, notes |
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

## Known behaviour, so it doesn't surprise you later

**Syllable counts are careful-speech counts.** CMU has `EVERY` as three
syllables (`EH1 V ER0 IY0`), so "counting every hour that you were gone" scores
11 even though you'd sing it as 9. The dictionary is right about the word and
wrong about the performance. Phase 2's beat anchoring is where you reconcile
that — pin the syllables you actually sing and let the rest collapse.

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

**No test suite, only a render smoke test.** `npm --prefix web run smoke`
renders the sheet and inspector against a running server and asserts the gutter,
rhyme tabs, segmentation, and empty states appear. It catches crashes, not
visual regressions.

**`line_timing` and `chords` tables already exist and are empty.** They are
phase 2 and 3 targets. Creating them now means those phases add routes, not
migrations.

---

## Provenance

- `data/cmudict-0.7b.txt` — CMU Pronouncing Dictionary, BSD-2-Clause. Not
  committed to the repo; `npm install` fetches it (and its license, retained
  at `data/CMUDICT-LICENSE.txt`) via `scripts/fetch-cmudict.mjs`
  (`postinstall`). Re-run with `npm run fetch:cmudict -- --force` if it's
  missing or you want to refresh it. Parsed ourselves rather than via the
  `cmudict` npm package, which was last published in 2012, ships no types,
  and parses the 3.6 MB file byte-by-byte with string concatenation.
- Project code: Unlicense.
