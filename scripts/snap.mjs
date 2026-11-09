// A screenshot of the app in a given state, for the docs and for looking at
// a change without clicking through it.
//
//   node scripts/snap.mjs --out docs/images/medal.png --preset medal
//   node scripts/snap.mjs --out shot.png --lang he --width 390 --height 844 --view 3d --camera iso
//   node scripts/snap.mjs --out shot.png --preset keychain --eval "document.querySelector('#plate_rim').click()"
//
// Flags: --out <png> (required); --preset <id> (a built-in preset, opened
// from the list); --lang en|ru|uk|he; --width/--height (default 1280 × 860);
// --view 2d|3d (a phone shows one at a time); --camera front|iso|back;
// --select <element id> (its card on show); --panel <css selector> (scrolls
// the panel to it); --swap (the 3D view big on a desktop); --eval <js> (run
// in the page before the shot); --preview (the production build).

import { check, launch, parseArgs } from './lib/harness.mjs';

const flags = parseArgs(process.argv.slice(2), ['out', 'preset', 'lang', 'width', 'height', 'view', 'camera', 'select', 'panel', 'eval']);
const out = flags.get('out');
const LOCALES = { en: 'en-US', ru: 'ru-RU', uk: 'uk-UA', he: 'he-IL' };
const BLANK = { 'plate-builder': JSON.stringify({ version: 2, settings: { locale: null, project: {}, presets: [] } }) };

const app = await launch({ preview: flags.has('preview') });
await app.run(async () => {
  check(out, '--out <png> is required');
  const viewport = { width: Number(flags.get('width') ?? 1280), height: Number(flags.get('height') ?? 860) };
  const { page } = await app.open({ viewport, locale: LOCALES[flags.get('lang') ?? 'en'], storage: BLANK });
  const settle = () =>
    page.waitForFunction(
      () => document.querySelector('#meshInfo')?.textContent !== '' && document.querySelector('#buildProgress')?.hidden,
      null,
      { timeout: 30000 },
    );
  await settle();
  if (flags.has('preset')) {
    await page.click('#presetsOpen');
    await page.click(`.preset-row[data-ref="b:${flags.get('preset')}"] .preset-pick`);
    await page.waitForTimeout(400);
    await settle();
  }
  if (flags.has('select')) await page.click(`.element-row[data-id="${flags.get('select')}"] .element-name`);
  if (flags.has('eval')) await page.evaluate(flags.get('eval'));
  if (flags.has('view') && (await page.locator('.view-tabs').isVisible()))
    await page.click(`.view-tabs [data-show="${flags.get('view')}"]`);
  if (flags.has('swap')) await page.click('#swapViews');
  if (flags.has('camera')) await page.click(`[data-camera="${flags.get('camera')}"]`);
  if (flags.has('panel')) await page.locator(flags.get('panel')).scrollIntoViewIfNeeded();
  // the debounced preview, the outline and the camera's damping
  await page.waitForTimeout(900);
  await settle();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
}, out);
