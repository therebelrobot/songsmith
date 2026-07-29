# Manual test — desktop writing flow

About five minutes. Use a scratch port and a scratch database — **do not**
run this against the production container on `:5180` / `./data/songsmith.db`.

```bash
mkdir -p /tmp/songsmith-manual
PORT=5199 SONGSMITH_DB=/tmp/songsmith-manual/scratch.db SONGSMITH_TOKEN= \
  node dist/index.js
```

Open `http://localhost:5199` in a desktop browser window (any width above
940px is fine).

## 1. Create a song and type four lines without touching the mouse

| Step | Expected result |
|---|---|
| Click **New song** | A song named "Untitled" opens. The section "Verse 1" is empty. |
| Click **Write the first line** | An empty line appears and is focused (caret visible, blinking). |
| Type `Counting hours that you were gone`, press **Enter** | A second, empty line appears below, and the caret is already in it — no click needed. |
| Type `Waiting by the door alone`, press **Enter** | A third empty line appears, focused. |
| Type `Nothing left but`, press **Shift+Enter**, then type `the radio` | The text wraps to a second visual row inside the *same* line (no new line was created) — the textarea grows taller. |
| Press **Enter** | A fourth, new, empty line appears, focused. |

You should have typed all four lines' worth of text without ever clicking
into a text field by hand after the first one.

## 2. The focus table, one row at a time

Reload the page and reopen the song from the list to reset state before each
row if you want a clean slate.

| Action | Expected result |
|---|---|
| Click a song in the left rail | The **first line** of the song is focused, caret at the end of its text — no click into the line needed. |
| Put the caret in the middle of a line's text and press **Enter** | A new, empty line appears directly below, and it is focused. The original line keeps everything before the caret; the new line gets what was after it. |
| Click **Add line** at the bottom of a section | A new empty line appears at the end of the section, focused. |
| Put the caret in an **empty** line and press **Backspace** | That line is deleted. Focus moves to the line above it, caret at the **end** of its text (not the beginning, not unfocused). |
| Make a *second* section's **first line** empty and press **Backspace** in it | That line is deleted. Focus moves to the **last line of the previous section**, caret at the end. |
| Delete the **only line** in the **first** section (empty it, then Backspace) | The line is deleted. Nothing is focused — no textarea has the caret. |
| Click **Add section** | A new section appears, and its **name field** (not a line) is focused and its text is selected, ready to type over. |

## 3. Watch it not steal focus mid-typing

| Step | Expected result |
|---|---|
| Start typing in a line and keep typing for a couple of seconds (past the ~500ms autosave debounce) | The caret does not jump, reset, or lose your position while the autosave request is in flight. The header's save indicator flips from "saving" to "saved" without disturbing you. |

## 4. Chords are reachable

| Step | Expected result |
|---|---|
| Open a song whose section shows **"No bars set, so there's nowhere for chords to go yet."** (any brand-new song's section from before this branch, or `PATCH` a section's `bar_count` to `null` yourself) | The message is visible, with a **"Set 8 bars"** link. |
| Click **Set 8 bars** | A bar ruler with 8 bars appears immediately, each with an empty dashed chord slot per beat — visible without hunting, not just on hover. |
| Click an empty chord slot, type `Am`, press Enter | The chord appears as a chip on the ruler. |

## 5. Header layout

| Step | Expected result |
|---|---|
| Open any song and look at the header | The title takes a reasonable amount of space (not the full row), and key / voice-leading / chord-numbers / save-state / tempo / transpose / export / transport all read as one coherent toolbar — not two rows where the second row looks unrelated to the first. |

## 6. Shortcuts are visible

| Step | Expected result |
|---|---|
| Look just above the lyric sheet | A low-contrast line reads `Enter new line · Shift+Enter line break · Backspace in an empty line deletes it`, styled quietly (monospace, dim, small `kbd`-style keys) — present without having to check the README. |

---

Stop the server (`Ctrl+C`) when done. `/tmp/songsmith-manual` is scratch —
delete it whenever.
