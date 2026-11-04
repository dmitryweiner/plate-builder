import { describe, expect, it } from 'vitest';
import { blockGeometry, hasRtl, MAX_RASTER_PX, rasterScale } from './textRaster';

const metrics = { cap: 7, advance: 12, ascent: 8, descent: 3, pad: 2 };

describe('blockGeometry', () => {
  it('stacks lines by the advance and aligns them within the widest', () => {
    const g = blockGeometry([10, 30], { ...metrics, align: 'right', arc: false });
    // the block: 30 wide plus the padding; the first baseline under the ascent and padding
    expect(g.width).toBe(34);
    expect(g.baselines).toEqual([10, 22]);
    expect(g.lefts).toEqual([22, 2]);
    expect(g.height).toBe(10 + 12 + 3 + 2);
  });

  it('centres a straight block between its first cap top and its last baseline', () => {
    const g = blockGeometry([10, 30], { ...metrics, align: 'center', arc: false });
    expect(g.originX).toBe(17);
    // cap top of line 1 at 10 − 7 = 3, last baseline at 22
    expect(g.originY).toBe((3 + 22) / 2);
    expect(g.lefts).toEqual([12, 2]);
  });

  it('puts an arc strip’s origin in its middle on the baseline', () => {
    const g = blockGeometry([30], { ...metrics, align: 'left', arc: true });
    expect([g.originX, g.originY]).toEqual([17, 10]);
  });
});

describe('rasterScale', () => {
  it('is 10 px/mm unless a side would pass the limit', () => {
    expect(rasterScale(50, 20)).toBe(10);
    expect(rasterScale(800, 20)).toBeCloseTo(MAX_RASTER_PX / 800);
  });
});

describe('hasRtl', () => {
  it('finds Hebrew letters', () => {
    expect(hasRtl('שלום')).toBe(true);
    expect(hasRtl('Dom 12')).toBe(false);
    expect(hasRtl('בית 5')).toBe(true);
  });
});
