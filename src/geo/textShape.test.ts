import { describe, expect, it } from 'vitest';
import { bounds, ringArea } from './outline';
import { isTextRaster, textRings, type TextRaster } from './textShape';

/** A 10 px/mm raster 40 × 20 px with a filled 20 × 8 px block whose middle is at (20, 10). */
function block(): TextRaster {
  const width = 40;
  const height = 20;
  const data = new Uint8Array(width * height);
  for (let j = 6; j < 14; j++) for (let i = 10; i < 30; i++) data[j * width + i] = 255;
  return { width, height, data, pxPerMm: 10, originX: 20, originY: 10, cap: 0.8 };
}

describe('textRings', () => {
  it('puts a straight block around the origin, in millimetres, y up', () => {
    const { rings, squeeze } = textRings(block(), { arc: false, arcRadius: 50, arcSide: 'outside' });
    expect(squeeze).toBe(1);
    const b = bounds(rings);
    expect(b.minX).toBeCloseTo(-1, 1);
    expect(b.maxX).toBeCloseTo(1, 1);
    expect(b.minY).toBeCloseTo(-0.4, 1);
    expect(b.maxY).toBeCloseTo(0.4, 1);
    expect(ringArea(rings[0] ?? [])).toBeGreaterThan(0);
  });

  it('bends a strip whose origin is on its baseline around the arc', () => {
    // the strip's baseline: the block's bottom edge, at row 14
    const raster = { ...block(), originY: 14 };
    const { rings } = textRings(raster, { arc: true, arcRadius: 10, arcSide: 'outside' });
    const b = bounds(rings);
    expect(b.minY).toBeGreaterThan(9.8);
    expect(b.maxY).toBeCloseTo(10.8, 1);
  });
});

describe('isTextRaster', () => {
  it('accepts a whole raster and refuses a broken one', () => {
    expect(isTextRaster(block())).toBe(true);
    expect(isTextRaster({ ...block(), data: new Uint8Array(3) })).toBe(false);
    expect(isTextRaster({ ...block(), pxPerMm: 0 })).toBe(false);
    expect(isTextRaster(null)).toBe(false);
  });
});
