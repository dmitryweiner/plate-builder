import './style.css';
import { startApp } from './app';
import { registerServiceWorker } from './pwa';
import { createScene } from './render/scene';
import { browserStorage } from './storage';
import { FONTS, fontReady, loadFont } from './ui/fonts';
import { decodeRaster, importImageFile } from './ui/imageImport';
import { rasterizeText } from './ui/textRaster';
import { csgClient } from './worker/client';

/** Hands a file to the browser as a download. */
function download(name: string, data: ArrayBuffer): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // the click has started the download; the URL is not needed after it
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

startApp({
  storage: browserStorage(),
  languages: navigator.languages,
  csg: csgClient(),
  createScene,
  download,
  timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) },
  pictures: { importFile: importImageFile, decode: decodeRaster },
  texts: { fontReady, loadFont, rasterize: (text) => rasterizeText(text, FONTS[text.font]) },
});
if (import.meta.env.PROD) registerServiceWorker(navigator, window);
