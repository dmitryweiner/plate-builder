// Browser smoke of the real app: the plate built by the worker and shown in
// 3D, every primitive outline, slider extremes, a real STL download,
// language detection and memory, RTL, no horizontal scroll on a phone, no
// console errors. With --preview it runs against a fresh production build
// and also checks that the service worker makes the app work offline.
//
//   npm run smoke               # dev server
//   npm run smoke -- --preview  # production build + offline check
//   npm run smoke -- --shots    # also saves shots/<viewport>-<locale>.png
//
// Prints one line per step; exits 1 on the first failed step or on any
// console error. New checks are new steps here, not new scripts.

import { readFileSync } from 'node:fs';
import { check, launch, parseArgs, VIEWPORTS } from './lib/harness.mjs';

const flags = parseArgs(process.argv.slice(2));
const preview = flags.has('preview');
const shots = flags.has('shots');
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
        if (shots) await built(page);
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
