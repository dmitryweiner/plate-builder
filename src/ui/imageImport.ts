// Image files → the stored picture (spec §3): grayscale + alpha, at most
// 512 px on the long side, kept in the project as a PNG data URL. Decoding a
// file and box-averaging it down are the kit's (`maker-kit/ui/imageImport`);
// here the picture is encoded as it is kept. The pure conversions are tested
// in Node; the browser glue at the end goes through a canvas.

import { importImage } from 'maker-kit/ui/imageImport';
import type { Raster } from '../geo/heightmap';
import { RANGES } from '../geo/state';

/** Gray into the colour channels, for a PNG. */
export function rasterToRgba(raster: Raster): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let i = 0; i < raster.width * raster.height; i++) {
    const g = raster.data[i * 2];
    out.set([g, g, g, raster.data[i * 2 + 1]], i * 4);
  }
  return out;
}

/** A stored PNG's pixels back into a raster (gray is any colour channel). */
export function rasterFromRgba(rgba: Uint8ClampedArray, width: number, height: number): Raster {
  const data = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    data[i * 2] = rgba[i * 4];
    data[i * 2 + 1] = rgba[i * 4 + 3];
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Browser glue: checked by the smoke, not vitest (jsdom has no canvas).

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D canvas');
  return ctx;
}

export interface ImportedImage {
  src: string;
  width: number;
  height: number;
  /** the same picture, decoded: no need to read the data URL back */
  raster: Raster;
}

/**
 * A file (PNG, JPEG, WebP, GIF's first frame, SVG) → the stored picture.
 * The kit decodes it through an <img>, so an SVG's scripts never run, and
 * refuses a file over its 20 MB.
 */
export async function importImageFile(file: Blob): Promise<ImportedImage> {
  const raster = await importImage(file, RANGES.pixels.max);
  const target = canvasOf(raster.width, raster.height);
  target.putImageData(new ImageData(rasterToRgba(raster), raster.width, raster.height), 0, 0);
  return { src: target.canvas.toDataURL('image/png'), width: raster.width, height: raster.height, raster };
}

/** A stored picture's data URL → its raster. */
export async function decodeRaster(src: string): Promise<Raster> {
  const image = await loadImage(src);
  const ctx = canvasOf(image.naturalWidth, image.naturalHeight);
  ctx.drawImage(image, 0, 0);
  return rasterFromRgba(ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data, image.naturalWidth, image.naturalHeight);
}

/**
 * What becomes height, as a picture: white is high, transparent where the
 * height is 0. `floor` lifts the lowest non-zero heights off black, so they
 * stay visible on a dark plate.
 */
export function heightPicture(field: Float32Array, width: number, height: number, floor = 40): HTMLCanvasElement | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.canvas.width = width;
  ctx.canvas.height = height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < field.length; i++) {
    const f = field[i];
    const g = floor + (255 - floor) * f;
    rgba.set([g, g, g, f > 1e-3 ? 255 : 0], i * 4);
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return ctx.canvas;
}
