import { describe, expect, it } from 'vitest';
import { fitView, panView, toPlate, toScreen, zoomAt } from './view';

describe('view transform', () => {
  it('puts the plate origin at the centre, y up, and round-trips', () => {
    const v = { scale: 4, cx: 200, cy: 150 };
    expect(toScreen(v, [10, 5])).toEqual([240, 130]);
    expect(toPlate(v, [240, 130])).toEqual([10, 5]);
  });

  it('fits a box with a margin, centred, whichever side limits', () => {
    const v = fitView({ width: 400, height: 300 }, { minX: -50, maxX: 50, minY: -30, maxY: 30 }, 20);
    expect(v.scale).toBeCloseTo(3.6);
    expect(toScreen(v, [0, 0])).toEqual([200, 150]);
    const tall = fitView({ width: 400, height: 300 }, { minX: -10, maxX: 10, minY: -100, maxY: 100 }, 20);
    expect(tall.scale).toBeCloseTo(1.3);
    const off = fitView({ width: 400, height: 300 }, { minX: 0, maxX: 100, minY: 0, maxY: 60 }, 20);
    expect(toScreen(off, [50, 30])).toEqual([200, 150]);
  });

  it('zooms about the pointer: the point under it stays put', () => {
    const v = { scale: 2, cx: 100, cy: 100 };
    const z = zoomAt(v, [160, 40], 1.5);
    expect(z.scale).toBe(3);
    const before = toPlate(v, [160, 40]);
    const after = toScreen(z, before);
    expect(after[0]).toBeCloseTo(160);
    expect(after[1]).toBeCloseTo(40);
  });

  it('keeps zoom within limits', () => {
    expect(zoomAt({ scale: 2, cx: 0, cy: 0 }, [0, 0], 1e6).scale).toBe(100);
    expect(zoomAt({ scale: 2, cx: 0, cy: 0 }, [0, 0], 1e-6).scale).toBe(0.2);
  });

  it('pans by screen pixels', () => {
    expect(panView({ scale: 2, cx: 10, cy: 20 }, 5, -3)).toEqual({ scale: 2, cx: 15, cy: 17 });
  });
});
