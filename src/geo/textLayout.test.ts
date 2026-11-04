import { describe, expect, it } from 'vitest';
import { ARC_FILL, arcFit, bendPoint, bendRings, lineOffsets } from './textLayout';
import { bounds, ringArea } from './outline';

describe('lineOffsets', () => {
  // three lines 10, 30 and 20 wide: the block is 30 wide around 0
  const widths = [10, 30, 20];
  it('aligns left, centre and right within the widest line', () => {
    expect(lineOffsets(widths, 'left')).toEqual([-15, -15, -15]);
    expect(lineOffsets(widths, 'center')).toEqual([-5, -15, -10]);
    expect(lineOffsets(widths, 'right')).toEqual([5, -15, -5]);
  });
});

describe('bendPoint', () => {
  const R = 40;
  const cap = 8;
  it('outside: x = 0 on the baseline lands on the top of the circle, a letter top further out', () => {
    expect(bendPoint([0, 0], R, 'outside', cap)).toEqual([0, 40]);
    const top = bendPoint([0, cap], R, 'outside', cap);
    expect(top[0]).toBeCloseTo(0);
    expect(top[1]).toBeCloseTo(48);
  });

  it('outside reads clockwise: further along the text is further right', () => {
    expect(bendPoint([10, 0], R, 'outside', cap)[0]).toBeGreaterThan(0);
  });

  it('inside: x = 0 lands on the bottom, letters stand towards the centre, read left to right', () => {
    const p = bendPoint([0, 0], R, 'inside', cap);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(-40);
    expect(bendPoint([0, cap], R, 'inside', cap)[1]).toBeCloseTo(-32);
    expect(bendPoint([10, 0], R, 'inside', cap)[0]).toBeGreaterThan(0);
  });

  it('keeps lengths along the arc at the middle of the letters', () => {
    for (const side of ['outside', 'inside'] as const) {
      const mid = side === 'outside' ? R + cap / 2 : R - cap / 2;
      const a = bendPoint([0, cap / 2], R, side, cap);
      const b = bendPoint([20, cap / 2], R, side, cap);
      const angle = Math.acos((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)));
      expect(angle * mid).toBeCloseTo(20, 6);
    }
  });
});

describe('arcFit', () => {
  it('leaves a strip that fits, squeezes one that does not', () => {
    expect(arcFit(100, 40, 'outside', 8)).toBe(1);
    const long = 2 * Math.PI * 44 * 2;
    expect(arcFit(long, 40, 'outside', 8)).toBeCloseTo(ARC_FILL / 2);
  });
});

describe('bendRings', () => {
  it('bends a strip around the circle and keeps it closed', () => {
    const strip: [number, number][] = [
      [-30, 0],
      [30, 0],
      [30, 8],
      [-30, 8],
    ];
    const { rings, squeeze } = bendRings([strip], 40, 'outside', 8);
    expect(squeeze).toBe(1);
    const b = bounds(rings);
    // densified edges follow the arc: the bottom edge's middle sits on the circle
    expect(b.minY).toBeLessThan(40 * Math.cos(30 / 44) + 0.5);
    expect(b.maxY).toBeCloseTo(48, 1);
    expect((rings[0] ?? []).length).toBeGreaterThan(20);
  });

  it('keeps counter-clockwise rings counter-clockwise on either side', () => {
    const strip: [number, number][] = [
      [-10, 0],
      [10, 0],
      [10, 8],
      [-10, 8],
    ];
    for (const side of ['outside', 'inside'] as const) expect(ringArea(bendRings([strip], 40, side, 8).rings[0] ?? [])).toBeGreaterThan(0);
  });
});
