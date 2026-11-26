import { describe, expect, it } from 'vitest';
import { rasterFromRgba, rasterToRgba } from './imageImport';

describe('raster ↔ RGBA', () => {
  it('stores gray in the colour channels and reads it back', () => {
    const raster = { width: 2, height: 1, data: new Uint8Array([10, 255, 200, 40]) };
    const pixels = rasterToRgba(raster);
    expect([...pixels]).toEqual([10, 10, 10, 255, 200, 200, 200, 40]);
    expect(rasterFromRgba(pixels, 2, 1)).toEqual(raster);
  });
});
