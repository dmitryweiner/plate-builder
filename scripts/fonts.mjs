// Fetches a Google Fonts family into public/fonts/ for the bundled fonts
// (spec §4, src/ui/fonts.ts): one weight's woff2 subsets as Google Fonts
// cuts them, `<file>-<subset>.woff2`, and the family's licence from
// github.com/google/fonts as `<file>-LICENSE.txt`. Prints each subset's
// size and unicode-range: they must match the ranges in src/ui/fonts.ts.
//
//   node scripts/fonts.mjs <family> <weight> <file> <subset…>
//   node scripts/fonts.mjs "Playfair Display" 900 playfair-display latin cyrillic
//   node scripts/fonts.mjs "Rubik Bubbles" 400 rubik-bubbles latin cyrillic hebrew

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [family, weight, file, ...subsets] = process.argv.slice(2);
if (!family || !weight || !file || subsets.length === 0) {
  console.error('usage: node scripts/fonts.mjs <family> <weight> <file> <subset…>');
  process.exit(1);
}

const out = resolve(import.meta.dirname, '../public/fonts');
// Google serves woff2 only to a browser that says it reads them
const headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

async function get(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

const css = await (await get(`https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@${weight}&display=swap`)).text();
// each face: /* subset */ @font-face { … src: url(…) format('woff2'); unicode-range: …; }
const faces = new Map(
  [...css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*{([^}]*)}/g)].map(([, subset, body]) => [
    subset,
    { url: body.match(/url\((https:[^)]+\.woff2)\)/)?.[1], range: body.match(/unicode-range:\s*([^;]+);/)?.[1] },
  ]),
);

for (const subset of subsets) {
  const face = faces.get(subset);
  if (!face?.url) throw new Error(`${family} ${weight} has no ${subset} subset (it has: ${[...faces.keys()].join(', ')})`);
  const bytes = new Uint8Array(await (await get(face.url)).arrayBuffer());
  writeFileSync(resolve(out, `${file}-${subset}.woff2`), bytes);
  console.log(`${file}-${subset}.woff2  ${bytes.length} bytes  ${face.range}`);
}

const dir = family.toLowerCase().replaceAll(' ', '');
const licence = await (await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/OFL.txt`)).text();
writeFileSync(resolve(out, `${file}-LICENSE.txt`), licence);
console.log(`${file}-LICENSE.txt  ${licence.split('\n')[0]}`);
