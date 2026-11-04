// Browser smoke of the real app: language detection and memory, RTL, the
// geometry worker's answer, no horizontal scroll on a phone, no console errors. With
// --preview it runs against a fresh production build and also checks that
// the service worker makes the app work offline.
//
//   npm run smoke               # dev server
//   npm run smoke -- --preview  # production build + offline check
//   npm run smoke -- --shots    # also saves shots/<viewport>-<locale>.png
//
// Prints one line per step; exits 1 on the first failed step or on any
// console error. New checks are new steps here, not new scripts.

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

/** Waits for the worker's pong; returns the time it reported. */
async function engineReady(page) {
  await page.waitForFunction(() => /ready in \d+ ms/.test(document.querySelector('#engine')?.textContent ?? ''), null, {
    timeout: 20000,
  });
  return (await page.locator('#engine').textContent()).match(/\d+/)[0];
}

try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await step(`English by default, the geometry worker answers (${name})`, async () => {
      const { page, context } = await app.open({ locale: 'de-DE', viewport });
      check((await page.locator('h1').textContent()) === 'Plate Builder', 'heading is not English');
      const ms = await engineReady(page);
      console.log(`    worker pong in ${ms} ms`);
      await context.close();
    });
  }

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
      check((await page.locator('h1').textContent()) === 'Plate Builder', 'the app did not load offline');
      await engineReady(page);
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
