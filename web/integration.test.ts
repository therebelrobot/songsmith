import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transposeChordSymbol } from './src/chords';
import { toNumber } from './src/nashville';

/**
 * End-to-end checks against a real running server, on a scratch port and a
 * scratch database — never the production 5180 / ./data/songsmith.db (see
 * the "already happened once" warning in the feature handoff). Lives outside
 * web/src (like smoke.tsx) so it's run directly with tsx rather than through
 * the typechecked build or the src/*.test.ts unit-test glob.
 *
 * Exercises two invariants that only mean anything against the actual HTTP
 * surface:
 *
 * 1. chord_display is a pure display setting: flipping it must not change a
 *    single stored/served chord symbol, only the field itself.
 * 2. Transposing a song rewrites every letter symbol, but the Nashville
 *    chart computed from those symbols (against the also-rewritten key) is
 *    unchanged — that's the entire point of the number system.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 58193;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForHealthy(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy in time');
}

async function withServer<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'songsmith-nashville-'));
  const dbPath = join(dir, 'scratch.db');
  let child: ChildProcess | undefined;
  try {
    child = spawn('npx', ['tsx', '--experimental-sqlite', 'src/index.ts'], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SONGSMITH_DB: dbPath, SONGSMITH_TOKEN: '' },
      stdio: 'pipe',
    });
    await waitForHealthy(Date.now() + 15_000);
    return await fn();
  } finally {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

interface ChordOut {
  id: number;
  bar: number;
  beat: number;
  symbol: string;
}

async function createSongWithChords(key: string): Promise<{ id: number; chords: ChordOut[] }> {
  const song = (await (
    await fetch(`${BASE}/api/songs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Invariant Song', song_key: key }),
    })
  ).json()) as { id: number };

  const specs = [
    { bar: 1, beat: 1, symbol: 'Am' },
    { bar: 1, beat: 3, symbol: 'F' },
    { bar: 2, beat: 1, symbol: 'C' },
    { bar: 3, beat: 1, symbol: 'G7' },
    { bar: 4, beat: 1, symbol: 'G/B' },
  ];
  const chords: ChordOut[] = [];
  for (const spec of specs) {
    const created = (await (
      await fetch(`${BASE}/api/songs/${song.id}/chords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(spec),
      })
    ).json()) as ChordOut;
    chords.push(created);
  }
  return { id: song.id, chords };
}

test('persistence invariant: toggling chord_display changes only that field, no chord symbol', async () => {
  await withServer(async () => {
    const { id } = await createSongWithChords('Am');

    const namesSong = (await (await fetch(`${BASE}/api/songs/${id}`)).json()) as Record<string, unknown>;
    const namesGrid = await (await fetch(`${BASE}/api/songs/${id}/grid`)).json();
    assert.equal(namesSong.chord_display, 'names');

    await fetch(`${BASE}/api/songs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chord_display: 'numbers' }),
    });

    const numbersSong = (await (await fetch(`${BASE}/api/songs/${id}`)).json()) as Record<string, unknown>;
    const numbersGrid = await (await fetch(`${BASE}/api/songs/${id}/grid`)).json();
    assert.equal(numbersSong.chord_display, 'numbers');

    // The grid never depends on chord_display — it's a client render choice.
    assert.deepEqual(numbersGrid, namesGrid);

    // The song rows differ only in chord_display (and updated_at, which any
    // PATCH bumps) — every other field, including every section/line, is untouched.
    const { chord_display: _n, updated_at: _nu, ...namesRest } = namesSong;
    const { chord_display: _num, updated_at: _numu, ...numbersRest } = numbersSong;
    assert.deepEqual(numbersRest, namesRest);
  });
});

test('transpose invariant: the numbers chart is unchanged by a real transpose round trip', async () => {
  await withServer(async () => {
    const key = 'Am';
    const { id, chords } = await createSongWithChords(key);

    const before = chords.map((c) => toNumber(c.symbol, key));

    const semitones = 3; // Am -> Cm
    const newKey = transposeChordSymbol(key, semitones);
    const transposed = chords.map((c) => ({ id: c.id, symbol: transposeChordSymbol(c.symbol, semitones) }));

    const res = await fetch(`${BASE}/api/songs/${id}/transpose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ song_key: newKey, chords: transposed }),
    });
    assert.equal(res.status, 200);

    const grid = (await (await fetch(`${BASE}/api/songs/${id}/grid`)).json()) as {
      chords: { id: number; symbol: string }[];
    };
    const chordsBySpec = new Map(grid.chords.map((c) => [c.id, c.symbol]));
    // The server wrote back exactly the letter symbols the client computed —
    // no server-side retransposition.
    for (const t of transposed) assert.equal(chordsBySpec.get(t.id), t.symbol);

    const after = chords.map((c) => toNumber(chordsBySpec.get(c.id) as string, newKey));
    assert.deepEqual(after, before);
  });
});
