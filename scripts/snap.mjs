// A screenshot of the app in a given state, for the docs and for looking at
// a change without clicking through it. --docs re-shoots every picture of
// docs/images (the list is below): run it after a change of the look.
//
//   node scripts/snap.mjs --out docs/images/medal.png --preset medal
//   node scripts/snap.mjs --out shot.png --lang he --width 390 --height 844 --view 3d --camera iso
//   node scripts/snap.mjs --out shot.png --preset keychain --eval "document.querySelector('#plate_rim').click()"
//   node scripts/snap.mjs --docs
//
// Flags: --out <png> (required, but for --docs); --preset <id> (a built-in
// preset, opened from the list); --lang en|ru|uk|he; --width/--height
// (default 1280 × 860); --view 2d|3d (a phone shows one at a time);
// --camera front|iso|back; --select <element id> (its card on show);
// --panel <css selector> (scrolls the panel to it); --swap (the 3D view big
// on a desktop); --eval <js> (run in the page before the shot); --preview
// (the production build).

import { check, launch, parseArgs } from './lib/harness.mjs';

const VALUE_FLAGS = ['out', 'preset', 'lang', 'width', 'height', 'view', 'camera', 'select', 'panel', 'eval'];
const LOCALES = { en: 'en-US', ru: 'ru-RU', uk: 'uk-UA', he: 'he-IL' };
const BLANK = { 'plate-builder': JSON.stringify({ version: 2, settings: { locale: null, project: {}, presets: [] } }) };

/** The pictures of docs/images and how each is made. */
const DOCS = [
  ['--out', 'docs/images/door-sign.png', '--preset', 'door-sign'],
  ['--out', 'docs/images/export.png', '--preset', 'door-sign', '--panel', '#exportCard'],
  ['--out', 'docs/images/hebrew.png', '--preset', 'door-sign', '--lang', 'he'],
  ['--out', 'docs/images/house-number.png', '--preset', 'house-number'],
  ['--out', 'docs/images/house-number-back.png', '--preset', 'house-number', '--swap', '--camera', 'back'],
  ['--out', 'docs/images/keychain.png', '--preset', 'keychain'],
  ['--out', 'docs/images/medal.png', '--preset', 'medal'],
  ['--out', 'docs/images/medal-image.png', '--preset', 'medal', '--select', 'i1', '--panel', '.element-row.open'],
  ['--out', 'docs/images/name-plate-text.png', '--preset', 'name-plate', '--select', 't1', '--panel', '.element-row.open'],
  ['--out', 'docs/images/pet-tag-phone.png', '--preset', 'pet-tag', '--width', '390', '--height', '844'],
  ['--out', 'docs/images/fridge-magnet-back.png', '--preset', 'fridge-magnet', '--swap', '--camera', 'back'],
  [
    '--out',
    'docs/images/door-sign-edges.png',
    '--preset',
    'door-sign',
    '--swap',
    '--camera',
    'iso',
    '--panel',
    '#plate_edgeSize',
    '--eval',
    "const n = document.querySelector('#plate_edgeSize_n'); n.value = '1.5'; n.dispatchEvent(new Event('change')); const p = document.querySelector('#plate_edgeProfile'); p.value = 'chamfer'; p.dispatchEvent(new Event('change'));",
  ],
];

const flags = parseArgs(process.argv.slice(2), VALUE_FLAGS);
const app = await launch({ preview: flags.has('preview') });

/** One shot in a fresh page, as its flags say. */
async function shot(o) {
  const out = o.get('out');
  check(out, '--out <png> is required');
  const viewport = { width: Number(o.get('width') ?? 1280), height: Number(o.get('height') ?? 860) };
  const { page, context } = await app.open({ viewport, locale: LOCALES[o.get('lang') ?? 'en'], storage: BLANK });
  const settle = () =>
    page.waitForFunction(
      () => document.querySelector('#meshInfo')?.textContent !== '' && document.querySelector('#buildProgress')?.hidden,
      null,
      { timeout: 30000 },
    );
  await settle();
  if (o.has('preset')) {
    await page.click('#presetsOpen');
    await page.click(`.preset-row[data-ref="b:${o.get('preset')}"] .preset-pick`);
    await page.waitForTimeout(400);
    await settle();
  }
  if (o.has('select')) await page.click(`.element-row[data-id="${o.get('select')}"] .element-name`);
  if (o.has('eval')) await page.evaluate(o.get('eval'));
  if (o.has('view') && (await page.locator('.view-tabs').isVisible())) await page.click(`.view-tabs [data-show="${o.get('view')}"]`);
  if (o.has('swap')) await page.click('#swapViews');
  if (o.has('camera')) await page.click(`[data-camera="${o.get('camera')}"]`);
  if (o.has('panel')) await page.locator(o.get('panel')).scrollIntoViewIfNeeded();
  // the debounced preview, the outline and the camera's damping
  await page.waitForTimeout(900);
  await settle();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  await context.close();
  console.log(out);
}

await app.run(async () => {
  if (flags.has('docs')) for (const args of DOCS) await shot(parseArgs(args, VALUE_FLAGS));
  else await shot(flags);
}, 'done');
