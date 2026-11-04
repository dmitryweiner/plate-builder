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
const launched = await launch({ preview });
/**
 * Every step starts from the plain default plate, as a returning visitor
 * with an empty project would (a first visit opens the first preset: its own
 * step). `{}` is a project that sanitising turns into the default.
 */
const BLANK = { 'plate-builder': JSON.stringify({ version: 2, settings: { locale: null, project: {}, presets: [] } }) };
const app = {
  ...launched,
  open: (options = {}) => launched.open({ storage: BLANK, ...options }),
  first: (options = {}) => launched.open(options),
};

async function step(name, fn) {
  app.label(name);
  await fn();
  console.log(`ok  ${name}`);
}

/** Waits until the build after the last edit is shown; returns the size line and the worker's time. */
async function built(page, before = '') {
  // read in the same moment as the wait: a next build may start right after
  const handle = await page.waitForFunction(
    (old) => {
      const status = document.querySelector('#status')?.textContent ?? '';
      const info = document.querySelector('#meshInfo')?.textContent ?? '';
      const ms = status.match(/built in (\d+) ms/);
      return ms && info !== '' && info !== old ? { info, ms: Number(ms[1]) } : null;
    },
    before,
    { timeout: 20000 },
  );
  return handle.jsonValue();
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

/** An SVG file of the given body, 200 × 100 units. */
const svgFile = (body) => ({
  name: 'frame.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">${body}</svg>`),
});

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

/** Waits until the shown build has this size line's start (a later build may land first). */
async function builtAs(page, prefix) {
  await page.waitForFunction(
    (p) =>
      (document.querySelector('#meshInfo')?.textContent ?? '').startsWith(p) &&
      /built in/.test(document.querySelector('#status')?.textContent ?? ''),
    prefix,
    { timeout: 20000 },
  );
  return page.locator('#meshInfo').textContent();
}

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

  await step('texts: two lines in each font, Cyrillic, Hebrew, raised, engraved, on an arc', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await page.click('#addText');
    // the font loads first: the text is built only then, 1 mm over the 3 mm base
    ({ info } = await built(page, info));
    check(info.includes('× 4 mm'), `raised text: ${info}`);
    const setText = async (value) => {
      await page.fill('#element-text', value);
      await page.locator('#element-text').dispatchEvent('change');
    };
    await setText('Kitchen\nКухня');
    ({ info } = await built(page, info));
    for (const font of ['oswald', 'ptSerif', 'comfortaa', 'marckScript', 'frankRuhl', 'rubik']) {
      await page.selectOption('#element-text-font', font);
      ({ info } = await built(page, info));
      check(info.includes('× 4 mm') && (await page.locator('#meshBlocked').isHidden()), `${font}: ${info}`);
    }
    await setText('שלום 12');
    ({ info } = await built(page, info));
    check(await page.locator('#meshBlocked').isHidden(), 'Hebrew: the mesh is blocked');
    await page.selectOption('#element-text-mode', 'engraved');
    ({ info } = await built(page, info));
    check(info.includes('× 3 mm'), `engraved text: ${info}`);
    await page.selectOption('#element-text-mode', 'raised');
    await setText('PLATE BUILDER');
    await page.check('#element-text-arc');
    await setNumber(page, 'element-text-arcRadius', 25);
    ({ info } = await built(page, info));
    check(info.includes('× 4 mm') && (await page.locator('#meshBlocked').isHidden()), `arc text: ${info}`);
    await page.selectOption('#element-text-arcSide', 'inside');
    ({ info } = await built(page, info));
    check(await page.locator('#meshBlocked').isHidden(), 'inside arc: the mesh is blocked');
    if (shots) await page.screenshot({ path: 'shots/texts-desktop.png' });
    console.log(`    arc text: ${info}`);
    await context.close();
  });

  await step('crop around an image and a text, padding at its extremes', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await page.selectOption('#plate-kind', 'crop');
    await page.setInputFiles('#imageFile', await testPicture(page, 'png'));
    ({ info } = await built(page, info));
    await page.click('#addText');
    ({ info } = await built(page, info));
    await setNumber(page, 'element-y', -40);
    ({ info } = await built(page, info));
    for (const padding of [0, 30, 3]) {
      await setNumber(page, 'plate-padding', padding);
      ({ info } = await built(page, info));
      check(await page.locator('#meshBlocked').isHidden(), `padding ${padding}: the mesh is blocked`);
      console.log(`    padding ${padding}: ${info}`);
    }
    // the disc and the text far apart: two islands at padding 3, said so
    const warnings = await page.locator('#warningList').textContent();
    check(/pieces/.test(warnings), `no islands warning: ${warnings}`);
    if (shots) await page.screenshot({ path: 'shots/crop-desktop.png' });
    await context.close();
  });

  await step('a rim on every kind', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await page.check('#plate-rim');
    for (const kind of ['rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'heart', 'shield', 'tag']) {
      await page.selectOption('#plate-kind', kind);
      ({ info } = await built(page, info));
      check(info.includes('× 4 mm') && (await page.locator('#meshBlocked').isHidden()), `${kind} with a rim: ${info}`);
    }
    await context.close();
  });

  await step('every catalog vignette with and without its frame, an own SVG, one with two islands', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await page.selectOption('#plate-kind', 'vignette');
    const ids = await page.locator('.vignette').evaluateAll((nodes) => nodes.map((n) => n.dataset.id));
    check(ids.length > 0, 'the catalog is empty');
    for (const id of ids) {
      await page.click(`.vignette[data-id="${id}"]`);
      ({ info } = await built(page, info));
      check(info.includes('× 4 mm') && (await page.locator('#meshBlocked').isHidden()), `${id} with its frame: ${info}`);
      await page.uncheck('#plate-frame');
      ({ info } = await built(page, info));
      check(info.includes('× 3 mm') && (await page.locator('#meshBlocked').isHidden()), `${id} without its frame: ${info}`);
      await page.check('#plate-frame');
      ({ info } = await built(page, info));
    }
    if (shots) await page.screenshot({ path: 'shots/vignette-desktop.png' });
    await page.setInputFiles('#svgFile', svgFile('<path fill-rule="evenodd" d="M0 0H200V100H0Z M20 20V80H180V20Z"/>'));
    ({ info } = await built(page, info));
    check(
      (await page.locator('#plate-kind').inputValue()) === 'svg' && (await page.locator('#meshBlocked').isHidden()),
      `own SVG: ${info}`,
    );
    await page.setInputFiles('#svgFile', svgFile('<rect width="80" height="100"/><rect x="120" width="80" height="100"/>'));
    ({ info } = await built(page, info));
    const warnings = await page.locator('#warningList').textContent();
    check(/2 pieces/.test(warnings), `two islands not warned: ${warnings}`);
    await context.close();
  });

  await step('warnings: each of them, "show" moves the view, a blocked export', async () => {
    const { page, context } = await app.open();
    let { info } = await built(page);
    await setNumber(page, 'plate-thickness', 1);
    ({ info } = await built(page, info));
    // a hole near the edge and one outside, overlapping; a keyhole too thin; a tall arc text with lines
    const hole = async (kind, x, y) => {
      await page.click('#addHole');
      await page.selectOption('#element-holeKind', kind);
      await setNumber(page, 'element-x', x);
      await setNumber(page, 'element-y', y);
    };
    await hole('round', 47, 0);
    await hole('round', 49, 3);
    await hole('keyhole', -30, 0);
    await page.click('#addText');
    await page.fill('#element-text', 'Kitchen\nDoor');
    await page.locator('#element-text').dispatchEvent('change');
    await setNumber(page, 'element-text-height', 4);
    await page.check('#element-text-arc');
    await setNumber(page, 'element-text-arcRadius', 5);
    ({ info } = await built(page, info));
    const codes = await page.locator('#warningList li').evaluateAll((items) => items.map((li) => li.dataset.code));
    for (const code of [
      'hole.nearEdge',
      'element.outside',
      'element.overlap',
      'keyhole.thin',
      'text.arcLines',
      'text.arcTooLong',
      'relief.tall',
    ]) {
      check(codes.includes(code), `no ${code} among ${codes.join(', ')}`);
    }
    const before = await page.locator('#view2d').getAttribute('data-view');
    await page.locator('#warningList li[data-code="hole.nearEdge"] button').click();
    const after = await page.locator('#view2d').getAttribute('data-view');
    check(before !== after, `"show" did not move the 2D view (${before} → ${after})`);
    if (shots) await page.screenshot({ path: 'shots/warnings-desktop.png' });
    // nothing to crop around: an empty mesh, the export blocked and said why
    await page.selectOption('#plate-kind', 'crop');
    await page.locator('.element-row [aria-label^="Delete"]').first().click();
    while ((await page.locator('.element-row').count()) > 0) await page.locator('.element-row [aria-label^="Delete"]').first().click();
    await page.waitForFunction(() => document.querySelector('#warningList li[data-code="mesh.invalid"]') !== null, null, {
      timeout: 20000,
    });
    check(await page.locator('#downloadStl').isDisabled(), 'a broken mesh can still be exported');
    console.log(`    ${codes.length} warnings: ${codes.join(', ')}`);
    await context.close();
  });

  await step('projects: a first visit, a reload keeps the project and its images, a file round trip, presets', async () => {
    const { page, context } = await app.first();
    let { info } = await built(page);
    check((await page.locator('#projectName').inputValue()) === 'Door sign', 'a first visit did not open the door sign');
    await page.setInputFiles('#imageFile', await testPicture(page, 'png'));
    ({ info } = await built(page, info));
    await setNumber(page, 'plate-width', 170);
    ({ info } = await built(page, info));
    // the save waits a second after the last edit
    await page.waitForTimeout(1500);
    await page.reload();
    info = await builtAs(page, '170 × 60').catch(() => page.locator('#meshInfo').textContent());
    check(info.startsWith('170 × 60'), `the reload lost the project: ${info}`);
    check((await page.locator('.element-row').count()) === 4, 'the reload lost an element');
    check(await page.locator('#selectedThumb').isHidden(), 'nothing should be selected after a reload');
    // the project file, out and back in
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#saveProject')]);
    const path = await download.path();
    check(download.suggestedFilename() === 'door-sign.plate.json', `file name ${download.suggestedFilename()}`);
    await page.click('.preset-row[data-id="medal"] button');
    info = await builtAs(page, '60 × 60');
    await page.setInputFiles('#projectFile', path);
    info = await builtAs(page, '170 × 60');
    // a user preset
    await page.click('#savePreset');
    check((await page.locator('.preset-row[data-id="u1"]').count()) === 1, 'the user preset is not listed');
    for (const id of ['keychain', 'pet-tag', 'house-number', 'name-plate']) {
      await page.click(`.preset-row[data-id="${id}"] button`);
      ({ info } = await built(page, info));
      check(await page.locator('#meshBlocked').isHidden(), `${id}: the mesh is blocked`);
      const warned = await page.locator('#warningList li').evaluateAll((items) => items.map((li) => li.dataset.code));
      check(warned.length === 0, `${id} has warnings: ${warned.join(', ')}`);
      if (shots) await page.screenshot({ path: `shots/preset-${id}.png` });
    }
    await context.close();
  });

  await step('a browser that refuses to store says so', async () => {
    const { page, context } = await app.open({
      script: () => {
        Storage.prototype.setItem = () => {
          throw new DOMException('quota', 'QuotaExceededError');
        };
      },
    });
    let { info } = await built(page);
    await setNumber(page, 'plate-width', 120);
    ({ info } = await built(page, info));
    await page.waitForFunction(() => !document.querySelector('#storageBanner')?.hidden, null, { timeout: 5000 });
    await context.close();
  });

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
