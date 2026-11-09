import 'maker-kit/styles/kit.css';
import './style.css';
import { download } from 'maker-kit/ui/files';
import { browserTimers } from 'maker-kit/ui/timers';
import { startApp } from './app';
import { registerServiceWorker } from './pwa';
import { createScene } from './render/scene';
import { browserStorage } from './storage';
import { FONTS, fontReady, loadFont } from './ui/fonts';
import { decodeRaster, importImageFile } from './ui/imageImport';
import { browserSilhouettes } from './ui/svgRaster';
import { rasterizeText } from './ui/textRaster';
import { csgClient } from './worker/client';

startApp({
  storage: browserStorage(),
  languages: navigator.languages,
  csg: csgClient(),
  createScene,
  download: (name, data, type) => download(name, data, type),
  timers: browserTimers,
  pictures: { importFile: importImageFile, decode: decodeRaster },
  texts: { fontReady, loadFont, rasterize: (text) => rasterizeText(text, FONTS[text.font]) },
  silhouettes: browserSilhouettes(import.meta.env.BASE_URL),
  // the width where style.css puts the panel beside the view
  narrow: window.matchMedia('(max-width: 1023px)'),
});
if (import.meta.env.PROD) registerServiceWorker(navigator, window);
