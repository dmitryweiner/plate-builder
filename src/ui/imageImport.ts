// Image files → the stored picture (spec §3): grayscale + alpha, at most
// 512 px on the long side, kept in the project as a PNG data URL. The pure
// conversions are tested in Node; the browser glue at the end decodes files
// and data URLs through a canvas.

import type { Raster } from '../geo/heightmap';
import { RANGES } from '../geo/state';

/** The largest file taken in (spec §13). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The stored size: the long side within `max`, the proportions kept, at least 1 px. */
export function fitPixels(width: number, height: number, max: number = RANGES.pixels.max): [number, number] {
  const long = Math.max(width, height);
  if (long <= max) return [width, height];
  return [Math.max(1, Math.round((width / long) * max)), Math.max(1, Math.round((height / long) * max))];
}

/**
 * Box-averages an RGBA picture down to fit `max` (as clayform's ornaments
 * do), turning colour into Rec. 601 gray. The gray is weighted by alpha, so
 * a transparent pixel's colour does not bleed into its neighbours.
 */
export function downscaleGrayAlpha(rgba: Uint8ClampedArray, sw: number, sh: number, max: number = RANGES.pixels.max): Raster {
  const [w, h] = fitPixels(sw, sh, max);
  const data = new Uint8Array(w * h * 2);
  for (let j = 0; j < h; j++) {
    const y0 = Math.floor((j * sh) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * sh) / h));
    for (let i = 0; i < w; i++) {
      const x0 = Math.floor((i * sw) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * sw) / w));
      let gray = 0;
      let alpha = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = (y * sw + x) * 4;
          const a = rgba[k + 3];
          gray += (0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2]) * a;
          alpha += a;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      data[(j * w + i) * 2] = alpha > 0 ? Math.round(gray / alpha) : 0;
      data[(j * w + i) * 2 + 1] = Math.round(alpha / count);
    }
  }
  return { width: w, height: h, data };
}

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
 * The browser decodes it through an <img>, so an SVG's scripts never run.
 */
export async function importImageFile(file: Blob): Promise<ImportedImage> {
  if (file.size > MAX_FILE_BYTES) throw new Error('file too large');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    // an SVG without its own size reports 0: draw it at the stored size
    const sw = image.naturalWidth || RANGES.pixels.max;
    const sh = image.naturalHeight || RANGES.pixels.max;
    // drawn at most at twice the stored size, then box-averaged down
    const [dw, dh] = fitPixels(sw, sh, RANGES.pixels.max * 2);
    const source = canvasOf(dw, dh);
    source.drawImage(image, 0, 0, dw, dh);
    const raster = downscaleGrayAlpha(source.getImageData(0, 0, dw, dh).data, dw, dh);
    const target = canvasOf(raster.width, raster.height);
    target.putImageData(new ImageData(rasterToRgba(raster), raster.width, raster.height), 0, 0);
    return { src: target.canvas.toDataURL('image/png'), width: raster.width, height: raster.height, raster };
  } finally {
    URL.revokeObjectURL(url);
  }
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
