# Manual test — mobile

About five minutes, on an actual phone (a desktop browser's device toolbar
gets you most of the way, but the font-size/zoom check and the virtual
keyboard check need a real touchscreen). Use a scratch port and a scratch
database — **do not** point at the production container on `:5180` /
`./data/songsmith.db`.

On your laptop, on the same LAN as your phone:

```bash
mkdir -p /tmp/songsmith-manual-mobile
PORT=5199 HOST=0.0.0.0 SONGSMITH_DB=/tmp/songsmith-manual-mobile/scratch.db SONGSMITH_TOKEN= \
  node dist/index.js
```

Find your laptop's LAN IP (`ipconfig getifaddr en0` on a Mac) and open
`http://<that-ip>:5199` on your phone. Keep the window under ~430px wide —
any modern phone in portrait qualifies.

## 1. Cold open reaches the writing surface

| Step | Expected result |
|---|---|
| Open the URL fresh | A compact top bar (**Songs** / title / **Tools** / **Notes**) is the only chrome. No song list, no header controls, no inspector on screen — just the top bar and (once a song is open) the lyric sheet. |
| Tap **Songs** | A drawer slides in from the left with the song list and **New song**. The rest of the screen dims. |
| Tap **New song** | The drawer closes, a new song opens, and the empty section's **"Write the first line"** prompt is visible without scrolling past anything else. |
| Tap **Write the first line** | The line is focused and the on-screen keyboard opens. |

## 2. Type four lines with the keyboard up

| Step | Expected result |
|---|---|
| With the keyboard open and a line focused, type a full line of lyrics | The focused line stays visible above the keyboard the whole time — it does not end up hidden underneath it. |
| Press **Enter** / tap **Return** on the keyboard | A new empty line appears below and is focused immediately, still visible above the keyboard — no tapping required to reach it. |
| Repeat for four lines total | All four lines typed without the keyboard ever needing to be dismissed and reopened, and without any line disappearing behind the keyboard. |
| Tap into an empty line and delete back to remove it | It's deleted; the line above it is focused, still visible above the keyboard. |

## 3. No zoom on focusing an input

| Step | Expected result |
|---|---|
| Tap into the lyric line, the section name field, the key field, the tempo field, and the chord entry field (open **Tools** and a chord slot for the last two) one at a time | The page does **not** zoom in when any of them gains focus. |

## 4. Reorder a line without drag

| Step | Expected result |
|---|---|
| With a song that has at least two lines in a section, find the two small **▲ / ▼** buttons to the right of a line | They're present and comfortably tappable (not a fiddly, tiny target). |
| Tap **▼** on the first line | It swaps with the line below it. The top button on the now-first line is disabled (greyed, unresponsive to tap) since there's nothing above it to move up into. |

## 5. Add a chord from the ruler

| Step | Expected result |
|---|---|
| Open **Tools**, confirm/set bars on the current section if needed, close **Tools** | The bar ruler is visible under the section header. |
| Swipe the ruler left/right | It scrolls horizontally at full size — the beat slots stay comfortably tap-sized rather than shrinking to fit the screen. |
| Tap an empty beat slot | A text entry opens; type `G` and confirm | A chord chip appears in that slot. |
| Tap the new chord chip | An editor opens with **◀ earlier** / **later ▶** buttons and a **Delete chord** button, all clearly tappable — this is the touch replacement for dragging a chord to a new slot. |
| Tap **later ▶** | The chord moves to the next beat slot. |

## 6. Metronome starts on a real tap

| Step | Expected result |
|---|---|
| Open **Tools**, set a tempo (type a number or tap **Tap** a few times) | A bpm value appears. |
| Tap **Play** | Sound starts immediately on that same tap — no second tap needed, no silence. (iOS suspends audio contexts created outside a direct tap; this confirms it isn't.) |
| Tap **Stop** | Sound stops. |

## 7. The rest of the chrome

| Step | Expected result |
|---|---|
| Tap **Notes** | The inspector (alternates / rhymes / history) slides in from the right, with a **Close** button. |
| Tap the dimmed area behind an open drawer | The drawer closes. |
| Open **Tools** and scroll down | Title, key, voice leading, chord numbers, tempo, transpose, export/import, and play/from-bar are all reachable in one bottom sheet with a **Done** button. |
| Select a line and tap its syllable count in the left gutter | A stress sparkline appears below the line (tap again to hide it) — it isn't taking up permanent space in every row. |

---

Stop the server (`Ctrl+C`) when done. `/tmp/songsmith-manual-mobile` is
scratch — delete it whenever.
