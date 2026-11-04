import { describe, expect, it } from 'vitest';
import { downscaleGrayAlpha, fitPixels, rasterFromRgba, rasterToRgba } from './imageImport';

/** RGBA pixels from [r, g, b, a] quadruples. */
const rgba = (pixels: number[][]) => new Uint8ClampedArray(pixels.flat());

describe('fitPixels', () => {
  it('keeps the long side within the limit and the proportions', () => {
    expect(fitPixels(2000, 1000, 512)).toEqual([512, 256]);
    expect(fitPixels(100, 3000, 512)).toEqual([17, 512]);
    expect(fitPixels(300, 200, 512)).toEqual([300, 200]);
    expect(fitPixels(5000, 1, 512)).toEqual([512, 1]);
  });
});

describe('downscaleGrayAlpha', () => {
  it('turns colour into Rec. 601 gray and keeps alpha', () => {
    const r = downscaleGrayAlpha(
      rgba([
        [255, 0, 0, 255],
        [0, 255, 0, 128],
        [0, 0, 255, 0],
        [255, 255, 255, 255],
      ]),
      4,
      1,
      512,
    );
    expect([r.width, r.height]).toEqual([4, 1]);
    expect([...r.data]).toEqual([76, 255, 150, 128, 0, 0, 255, 255]);
  });

  it('averages blocks, the gray weighted by alpha so a transparent pixel lends no colour', () => {
    // 4 × 1 → 2 × 1: a white pixel beside a transparent black one stays white, half covered
    const r = downscaleGrayAlpha(
      rgba([
        [255, 255, 255, 255],
        [0, 0, 0, 0],
        [100, 100, 100, 255],
        [200, 200, 200, 255],
      ]),
      4,
      1,
      2,
    );
    expect([...r.data]).toEqual([255, 128, 150, 255]);
  });

  it('gives a fully transparent block gray 0', () => {
    const r = downscaleGrayAlpha(
      rgba([
        [255, 255, 255, 0],
        [255, 255, 255, 0],
      ]),
      2,
      1,
      1,
    );
    expect([...r.data]).toEqual([0, 0]);
  });
});

describe('raster ↔ RGBA', () => {
  it('stores gray in the colour channels and reads it back', () => {
    const raster = { width: 2, height: 1, data: new Uint8Array([10, 255, 200, 40]) };
    const pixels = rasterToRgba(raster);
    expect([...pixels]).toEqual([10, 10, 10, 255, 200, 200, 200, 40]);
    expect(rasterFromRgba(pixels, 2, 1)).toEqual(raster);
  });
});
