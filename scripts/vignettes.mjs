// The vignette catalog (public/vignettes/): checks every entry and renders
// a contact sheet for review. The SVGs are drawn by a real browser, as the
// app draws them.
//
//   node scripts/vignettes.mjs --check          # every entry: one piece with a window, the index complete
//   node scripts/vignettes.mjs --sheet shots    # shots/vignettes.png and .html: each one, its outline and frame
//
// --check exits 1 when an entry fails. Run it after adding or changing a
// vignette; the sheet is what the user reviews before a new one is committed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, launch, parseArgs } from './lib/harness.mjs';

const flags = parseArgs(process.argv.slice(2), ['sheet']);
const root = resolve(import.meta.dirname, '..');
const index = JSON.parse(readFileSync(resolve(root, 'public/vignettes/index.json'), 'utf8'));
const LICENCES = new Set(['CC0-1.0', 'public-domain']);
const LOCALES = ['en', 'ru', 'uk', 'he'];

const app = await launch();
const failures = [];
try {
  const { page } = await app.open();
  for (const entry of index.vignettes) {
    const problems = [];
    if (!/^[a-z0-9-]{1,64}$/.test(entry.id ?? '')) problems.push('bad id');
    if (entry.file !== `${entry.id}.svg`) problems.push('the file is not <id>.svg');
    for (const l of LOCALES) if (!entry.names?.[l]) problems.push(`no ${l} name`);
    if (!entry.source || !entry.author) problems.push('no source or author');
    if (!LICENCES.has(entry.licence)) problems.push(`licence ${entry.licence} is not allowed`);
    // ink components and enclosed holes of the drawing, by flood fill on a 400 px raster
    const shape = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const aspect = image.naturalWidth / image.naturalHeight || 1;
      const w = aspect >= 1 ? 400 : Math.round(400 * aspect);
      const h = aspect >= 1 ? Math.round(400 / aspect) : 400;
      const canvas = document.createElement('canvas');
      canvas.width = w + 4;
      canvas.height = h + 4;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 2, 2, w, h);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const W = canvas.width;
      const H = canvas.height;
      const ink = new Uint8Array(W * H);
      for (let i = 0; i < ink.length; i++) ink[i] = rgba[i * 4 + 3] > 127 ? 1 : 0;
      const seen = new Uint8Array(W * H);
      const fill = (start, value) => {
        const stack = [start];
        seen[start] = 1;
        let touchesEdge = false;
        while (stack.length) {
          const p = stack.pop();
          const x = p % W;
          const y = (p - x) / W;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
          for (const q of [p - 1, p + 1, p - W, p + W]) {
            if (q < 0 || q >= W * H || seen[q] || ink[q] !== value) continue;
            if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
            seen[q] = 1;
            stack.push(q);
          }
        }
        return touchesEdge;
      };
      let pieces = 0;
      let windows = 0;
      for (let p = 0; p < W * H; p++) {
        if (seen[p]) continue;
        if (ink[p]) {
          fill(p, 1);
          pieces++;
        } else if (!fill(p, 0)) windows++;
      }
      // the outline: everything the outside does not reach, as a picture for the sheet
      const outside = new Uint8Array(W * H);
      const stack = [0];
      outside[0] = 1;
      while (stack.length) {
        const p = stack.pop();
        const x = p % W;
        for (const q of [p - 1, p + 1, p - W, p + W]) {
          if (q < 0 || q >= W * H || outside[q] || ink[q]) continue;
          if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
          outside[q] = 1;
          stack.push(q);
        }
      }
      const out = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) out.data.set(outside[i] ? [0, 0, 0, 0] : [41, 78, 219, 255], i * 4);
      ctx.putImageData(out, 0, 0);
      return { pieces, windows, aspect, outline: canvas.toDataURL() };
    }, `${app.base}vignettes/${entry.file}`);
    if (shape.pieces !== 1) problems.push(`${shape.pieces} pieces of ink, not one`);
    if (shape.windows < 1) problems.push('no window inside');
    console.log(
      `${problems.length ? 'FAIL' : 'ok  '} ${entry.id}: ${shape.pieces} piece, ${shape.windows} window(s), aspect ${shape.aspect.toFixed(2)}${problems.length ? ` — ${problems.join('; ')}` : ''}`,
    );
    if (problems.length) failures.push(entry.id);
    entry.outline = shape.outline;
  }

  if (flags.has('sheet')) {
    const dir = resolve(root, flags.get('sheet'));
    mkdirSync(dir, { recursive: true });
    const cells = index.vignettes
      .map(
        (e) => `<figure>
  <div class="pair">
    <img src="${app.base}vignettes/${e.file}" alt="">
    <img src="${e.outline}" alt="">
  </div>
  <figcaption><b>${e.names.en}</b> · ${e.id}<br>${e.author} · ${e.licence}${e.modified ? ` · modified: ${e.modified}` : ''}<br><small>${e.source}</small></figcaption>
</figure>`,
      )
      .join('\n');
    // left: the frame as it is raised; right: the plate's outline, the silhouette with its windows filled
    const html = `<!doctype html><meta charset="utf-8"><title>Vignettes</title>
<style>
  body { font: 13px system-ui; margin: 16px; background: #f4f6fc; }
  main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  figure { margin: 0; padding: 8px; background: #fff; border-radius: 8px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .pair img { inline-size: 100%; aspect-ratio: 3 / 2; object-fit: contain; background: #e3e7f2; }
</style>
<h1>Vignettes: the frame (left) and the plate's outline (right)</h1>
<main>${cells}</main>`;
    writeFileSync(resolve(dir, 'vignettes.html'), html);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: resolve(dir, 'vignettes.png'), fullPage: true });
    console.log(`sheet: ${resolve(dir, 'vignettes.png')}`);
  }
  check(failures.length === 0, `failed: ${failures.join(', ')}`);
  check(app.errors.length === 0, `console errors:\n${app.errors.join('\n')}`);
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
