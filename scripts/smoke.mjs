// Browser smoke of the real app: the plate built by the worker and shown in
// 3D, every primitive outline, slider extremes, a real STL download,
// language detection and memory, RTL, no horizontal scroll on a phone, no
// console errors. With --preview it runs against a fresh production build
// and also checks that the service worker makes the app work offline.
//
//   npm run smoke               # dev server
//   npm run smoke -- --preview  # production build + offline check
//   npm run smoke -- --shots    # also saves shots/<viewport>-<locale>.png
//   npm run smoke -- --measure  # also times images on small and large plates
//
// Prints one line per step; exits 1 on the first failed step or on any
// console error. New checks are new steps here, not new scripts.

import { readFileSync } from 'node:fs';
import { check, launch, parseArgs, VIEWPORTS } from './lib/harness.mjs';

const flags = parseArgs(process.argv.slice(2));
const preview = flags.has('preview');
const shots = flags.has('shots');
// --measure: the image timings of plan M3 (preview and export of a 512 px image on 100 × 60 and 300 × 300)
const measure = flags.has('measure');
const app = await launch({ preview });

async function step(name, fn) {
  app.label(name);
  await fn();
  console.log(`ok  ${name}`);
}

/** Waits until the build after the last edit is shown; returns the size line and the worker's time. */
async function built(page, before = '') {
  await page.waitForFunction(
    (old) => {
      const status = document.querySelector('#status')?.textContent ?? '';
      const info = document.querySelector('#meshInfo')?.textContent ?? '';
      return /built in \d+ ms/.test(status) && info !== '' && info !== old;
    },
    before,
    { timeout: 20000 },
  );
  const status = await page.locator('#status').textContent();
  return { info: await page.locator('#meshInfo').textContent(), ms: Number(status.match(/\d+/)[0]) };
}

/**
 * Where a plate point is on the page in the 2D view as first fitted: the
 * default 100 × 60 plate in the middle of the canvas, 24 px from its edges
 * (editor/view.ts fitView).
 */
async function plateToPage(page, [x, y]) {
  const box = await page.locator('#view2d').boundingBox();
  const scale = Math.min((box.width - 48) / 100, (box.height - 48) / 60);
  return [box.x + box.width / 2 + x * scale, box.y + box.height / 2 - y * scale, scale];
}

/** A mouse drag between plate points, in steps. */
async function mouseDrag(page, from, to, { shift = false } = {}) {
  const [x0, y0] = await plateToPage(page, from);
  const [x1, y1] = await plateToPage(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

/**
 * Test pictures drawn in the page: a PNG disc fading out on a transparent
 * ground, or a JPEG of soft noise like a photo. Returns a file for setInputFiles.
 */
async function testPicture(page, kind, width = 512, height = 512) {
  const base64 = await page.evaluate(
    async ([type, w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (type === 'png') {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.7, 'rgba(120,120,120,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      } else {
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const v = 128 + 60 * Math.sin(x / 17) * Math.cos(y / 23) + 40 * Math.sin((x + y) / 7);
            img.data.set([v, v * 0.9, v * 0.8, 255], (y * w + x) * 4);
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const blob = await new Promise((r) => canvas.toBlob(r, type === 'png' ? 'image/png' : 'image/jpeg', 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    },
    [kind, width, height],
  );
  return {
    name: `test.${kind === 'png' ? 'png' : 'jpg'}`,
    mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
    buffer: Buffer.from(base64, 'base64'),
  };
}

/** Clicks the download and returns the worker's time of the export. */
async function exportMs(page) {
  const before = await page.locator('#exportStatus').textContent();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#downloadStl')]);
  await download.path();
  await page.waitForFunction(
    (old) =>
      /saved/.test(document.querySelector('#exportStatus')?.textContent ?? '') &&
      document.querySelector('#exportStatus')?.textContent !== old,
    before,
  );
  return Number((await page.locator('#exportStatus').textContent()).match(/(\d+) ms/)[1]);
}

const fieldValue = async (page, id) => Number(await page.locator(`#${id}-n`).inputValue());

/** Sets a range control through its exact number field. */
async function setNumber(page, id, value) {
  await page.fill(`#${id}-n`, String(value));
  await page.locator(`#${id}-n`).dispatchEvent('change');
}

try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await step(`English by default, the plate is built and shown in 3D (${name})`, async () => {
      const { page, context } = await app.open({ locale: 'de-DE', viewport });
      check((await page.locator('.brand').textContent()) === 'Plate Builder', 'brand is not English');
      const { info, ms } = await built(page);
      check(info.startsWith('100 × 60 × 3 mm'), `unexpected size: ${info}`);
      const editor = await page.locator('#view2d').boundingBox();
      check(editor && editor.width > 200 && editor.height > 200, 'the 2D view has no room');
      // a phone shows one view at a time
      if (name === 'phone') await page.click('.view-tabs [data-show="3d"]');
      const canvas = await page.locator('#view3d').boundingBox();
      check(canvas && canvas.width > 200 && canvas.height > 200, 'the 3D view has no room');
      for (const camera of ['front', 'back', 'iso']) await page.click(`[data-camera="${camera}"]`);
      console.log(`    first build: ${ms} ms in the worker; ${info}`);
      await context.close();
    });
  }

  await step('every primitive outline builds a valid mesh', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    for (const kind of ['ellipse', 'triangle', 'polygon', 'star', 'heart', 'shield', 'tag', 'rectangle']) {
      await page.selectOption('#plate-kind', kind);
      // the size stays, the triangle count changes: wait for any new line
      ({ info } = await built(page, info));
      check(info.startsWith('100 × 60 × 3 mm'), `${kind}: unexpected size ${info}`);
      check(await page.locator('#meshBlocked').isHidden(), `${kind}: the mesh is blocked`);
    }
    await context.close();
  });

  await step('slider extremes', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    const cases = [
      ['plate-width', 300, '300 × 60 × 3 mm'],
      ['plate-height', 300, '300 × 300 × 3 mm'],
      ['plate-thickness', 20, '300 × 300 × 20 mm'],
      ['plate-rounding', 150, '300 × 300 × 20 mm'],
      ['plate-width', 10, '10 × 300 × 20 mm'],
      ['plate-height', 10, '10 × 10 × 20 mm'],
      ['plate-thickness', 0.6, '10 × 10 × 0.6 mm'],
    ];
    for (const [id, value, size] of cases) {
      await setNumber(page, id, value);
      ({ info } = await built(page, info));
      check(info.startsWith(size), `${id} = ${value}: ${info}`);
      check(await page.locator('#meshBlocked').isHidden(), `${id} = ${value}: the mesh is blocked`);
    }
    for (const kind of ['star', 'polygon', 'heart']) {
      await page.selectOption('#plate-kind', kind);
      ({ info } = await built(page, info));
      check(await page.locator('#meshBlocked').isHidden(), `${kind} at 10 × 10 with full rounding: the mesh is blocked`);
    }
    await context.close();
  });

  await step('each hole kind: add, drag, scale, turn, undo (desktop)', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await page.uncheck('#snapping');
    for (const kind of ['round', 'slot', 'countersunk', 'keyhole']) {
      await page.click('#addHole');
      await page.selectOption('#element-holeKind', kind);
      // a keyhole needs a thicker plate; the warning says so, the mesh still builds
      await mouseDrag(page, [0, 0], [-20, 10]);
      check(Math.abs((await fieldValue(page, 'element-x')) + 20) < 0.3, `${kind}: drag did not move it`);
      // the top right corner of a round hole's box is at (r, r) from its centre
      if (kind === 'round') {
        await mouseDrag(page, [-18, 12], [-16, 14]);
        check((await fieldValue(page, 'element-diameter')) > 5, `round: the corner did not scale it`);
      }
      if (kind === 'slot') {
        // the rotation handle: 28 px above the top edge's middle
        const [, , scale] = await plateToPage(page, [0, 0]);
        const width = await fieldValue(page, 'element-width');
        const above = width / 2 + 28 / scale;
        await mouseDrag(page, [-20, 10 + above], [-20 - 30, 10], { shift: true });
        check((await fieldValue(page, 'element-rotation')) === 90, `slot: turned to ${await fieldValue(page, 'element-rotation')}`);
      }
      ({ info } = await built(page, info));
      check(await page.locator('#meshBlocked').isHidden(), `${kind}: the mesh is blocked`);
      await page.click('#undo');
      if (kind === 'round' || kind === 'slot') await page.click('#undo');
      check(
        Math.abs(await fieldValue(page, 'element-x')) < 1e-9,
        `${kind}: undo did not bring it back (x = ${await fieldValue(page, 'element-x')})`,
      );
      // move it out of the way of the next one
      await page.fill('#element-y-n', String(-20));
      await page.locator('#element-y-n').dispatchEvent('change');
      await page.fill('#element-x-n', String(-40 + 25 * ['round', 'slot', 'countersunk', 'keyhole'].indexOf(kind)));
      await page.locator('#element-x-n').dispatchEvent('change');
    }
    check((await page.locator('.element-row').count()) === 4, 'four holes in the list');
    await page.fill('#plate-thickness-n', '6');
    await page.locator('#plate-thickness-n').dispatchEvent('change');
    ({ info } = await built(page, info));
    check(await page.locator('#meshBlocked').isHidden(), 'four holes: the mesh is blocked');
    await page.click('[data-camera="back"]');
    if (shots) await page.screenshot({ path: 'shots/holes-desktop.png' });
    console.log(`    four holes: ${info}`);
    await context.close();
  });

  await step('a touch drag on a phone moves a hole', async () => {
    const { page, context } = await app.open({ viewport: VIEWPORTS.phone });
    await built(page);
    await page.click('#addHole');
    const [x0, y0] = await plateToPage(page, [0, 0]);
    const [x1, y1] = await plateToPage(page, [15, -10]);
    const canvas = page.locator('#view2d');
    const touch = (type, x, y) =>
      canvas.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true });
    await touch('pointerdown', x0, y0);
    for (let i = 1; i <= 5; i++) await touch('pointermove', x0 + ((x1 - x0) * i) / 5, y0 + ((y1 - y0) * i) / 5);
    await touch('pointerup', x1, y1);
    const [x, y] = [await fieldValue(page, 'element-x'), await fieldValue(page, 'element-y')];
    check(Math.abs(x - 15) < 0.5 && Math.abs(y + 10) < 0.5, `touch drag landed at ${x}, ${y}`);
    if (shots) await page.screenshot({ path: 'shots/phone-2d.png' });
    await context.close();
  });

  await step('images: a transparent PNG and a JPEG, every parameter at its extremes', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await page.setInputFiles('#imageFile', await testPicture(page, 'png'));
    ({ info } = await built(page, info));
    check((await page.locator('.element-row').count()) === 1, 'the PNG did not become an image');
    check(await page.locator('#selectedThumb').isVisible(), 'no height picture in the card');
    // the disc rises 1.5 mm over the 3 mm base
    check(info.includes('× 4.5 mm'), `PNG relief: ${info}`);
    const cases = [
      ['element-height', 10],
      ['element-height', 0.1],
      ['element-size', 300],
      ['element-size', 5],
      ['element-black', 254],
      ['element-black', 0],
      ['element-white', 1],
      ['element-blur', 5],
      ['element-rotation', 359],
    ];
    for (const [id, value] of cases) {
      await setNumber(page, id, value);
      ({ info } = await built(page, info).catch(() => ({ info })));
      check(await page.locator('#meshBlocked').isHidden(), `${id} = ${value}: the mesh is blocked`);
    }
    await page.check('#element-invert');
    await page.setInputFiles('#imageFile', await testPicture(page, 'jpeg', 640, 480));
    ({ info } = await built(page, info));
    check((await page.locator('.element-row').count()) === 2, 'the JPEG did not become an image');
    check(await page.locator('#meshBlocked').isHidden(), 'two images: the mesh is blocked');
    if (shots) await page.screenshot({ path: 'shots/images-desktop.png' });
    const ms = await exportMs(page);
    console.log(`    two images: ${info}; export ${ms} ms`);
    await context.close();
  });

  if (measure) {
    await step('measure: one 512 px image on 100 × 60 and on 300 × 300', async () => {
      const { page, context } = await app.open();
      let { info } = await built(page);
      await page.setInputFiles('#imageFile', await testPicture(page, 'jpeg'));
      for (const [w, h, size] of [
        [100, 60, 55],
        [300, 300, 290],
      ]) {
        await setNumber(page, 'plate-width', w);
        await setNumber(page, 'plate-height', h);
        await page.click('.element-name');
        await setNumber(page, 'element-size', size);
        const result = await built(page, info);
        info = result.info;
        const ms = await exportMs(page);
        console.log(`    ${w} × ${h}, image ${size} mm: preview ${result.ms} ms (${info}); export ${ms} ms`);
      }
      await context.close();
    });
  }

  await step('downloads a real STL', async () => {
    const { page, context } = await app.open();
    await built(page);
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadStl')]);
    const path = await download.path();
    const bytes = readFileSync(path);
    const count = bytes.readUInt32LE(80);
    check(download.suggestedFilename() === 'plate.stl', `file name ${download.suggestedFilename()}`);
    check(bytes.length === 84 + 50 * count && count > 0, `broken STL: ${bytes.length} bytes, ${count} triangles`);
    check(bytes.subarray(0, 13).toString() === 'Plate Builder', 'STL header');
    await page.waitForFunction(() => /saved/.test(document.querySelector('#exportStatus')?.textContent ?? ''));
    console.log(
      `    ${count} triangles, ${bytes.length} bytes, ${Date.now() - started} ms from the click; ${await page.locator('#exportStatus').textContent()}`,
    );
    await context.close();
  });

  await step('browser language is detected, the choice survives a reload', async () => {
    const { page, context } = await app.open({ locale: 'ru-RU' });
    check((await page.locator('html').getAttribute('lang')) === 'ru', 'ru-RU browser did not get Russian');
    await page.selectOption('#locale', 'en');
    await page.reload();
    check((await page.locator('html').getAttribute('lang')) === 'en', 'the switcher choice was lost on reload');
    await context.close();
  });

  await step('Hebrew turns the page right-to-left', async () => {
    const { page, context } = await app.open({ locale: 'he-IL' });
    check((await page.locator('html').getAttribute('dir')) === 'rtl', 'he-IL browser did not get dir=rtl');
    const select = await page.locator('#locale').boundingBox();
    check(select !== null && select.x < VIEWPORTS.desktop.width / 2, 'the language switcher did not move to the left');
    await context.close();
  });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    for (const locale of ['en-US', 'he-IL']) {
      await step(`no horizontal scroll on ${name} (${viewport.width}px, ${locale})`, async () => {
        const { page, context } = await app.open({ viewport, locale });
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        check(width <= viewport.width, `page is ${width}px wide`);
        // any language: the size line appears once the first build is shown
        if (shots) await page.waitForFunction(() => document.querySelector('#meshInfo')?.textContent !== '', null, { timeout: 20000 });
        if (shots) await page.screenshot({ path: `shots/${name}-${locale}.png`, fullPage: true });
        await context.close();
      });
    }
  }

  if (preview) {
    await step('works offline after the first visit', async () => {
      const { page, context } = await app.open();
      await page.evaluate(() => navigator.serviceWorker.ready);
      await context.setOffline(true);
      await page.reload();
      check((await page.locator('.brand').textContent()) === 'Plate Builder', 'the app did not load offline');
      await built(page);
      await context.close();
    });
  }

  check(app.errors.length === 0, `console errors:\n${app.errors.join('\n')}`);
  console.log(`smoke passed (${preview ? 'preview' : 'dev'})`);
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
