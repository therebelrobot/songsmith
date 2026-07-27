// Fetches the CMU Pronouncing Dictionary and its license into data/, since we
// don't vendor them in the repo (3.5 MB of generated text with no diffs worth
// tracking). Runs as a postinstall step; safe to re-run manually via
// `npm run fetch:cmudict`.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

// cmusphinx/cmudict no longer ships the classic 0.7b format (only the newer
// cmudict.dict), so we pull from a mirror that preserves the original
// releases. See README.md#provenance.
const FILES = [
  {
    dest: join(dataDir, 'cmudict-0.7b.txt'),
    url: 'https://raw.githubusercontent.com/Alexir/CMUdict/master/cmudict-0.7b',
  },
  {
    dest: join(dataDir, 'CMUDICT-LICENSE.txt'),
    url: 'https://raw.githubusercontent.com/Alexir/CMUdict/master/LICENSE',
  },
];

const force = process.argv.includes('--force');

async function fetchFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  mkdirSync(dataDir, { recursive: true });

  for (const { dest, url } of FILES) {
    if (!force && existsSync(dest)) {
      console.log(`[fetch-cmudict] skip ${dest} (already present)`);
      continue;
    }
    console.log(`[fetch-cmudict] fetching ${url}`);
    try {
      await fetchFile(url, dest);
      console.log(`[fetch-cmudict] wrote ${dest}`);
    } catch (err) {
      console.warn(
        `[fetch-cmudict] failed to fetch ${url}: ${err.message}\n` +
          '  Prosody analysis will fail with ENOENT until this succeeds.\n' +
          '  Re-run with: npm run fetch:cmudict -- --force',
      );
    }
  }
}

main();
