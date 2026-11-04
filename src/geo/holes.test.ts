import { describe, expect, it } from 'vitest';
import { holeBox, holeCutters, holeFootprint, keyholeMinThickness, placePoint, stadium } from './holes';
import { bounds, ringArea } from './outline';
import { defaultHole, HOLE_KINDS, type HoleElement } from './state';

const hole = (kind: HoleElement['kind'], over: Partial<HoleElement> = {}): HoleElement => ({ ...defaultHole(kind), id: 'h1', ...over });

describe('hole footprints', () => {
  it('have the area of their shape, counter-clockwise', () => {
    expect(ringArea(holeFootprint(hole('round', { diameter: 10 })))).toBeCloseTo(Math.PI * 25, 0);
    // a stadium 12 long, 3 wide: a 9 × 3 rectangle and a circle of 3
    expect(ringArea(holeFootprint(hole('slot')))).toBeCloseTo(9 * 3 + Math.PI * 2.25, 0);
    expect(ringArea(holeFootprint(hole('countersunk')))).toBeCloseTo(Math.PI * 4.25 ** 2, 0);
    expect(ringArea(holeFootprint(hole('keyhole')))).toBeCloseTo(10 * 8 + Math.PI * 16, 0);
  });

  it('a slot shorter than wide is a circle', () => {
    expect(ringArea(holeFootprint(hole('slot', { length: 2, width: 6 })))).toBeCloseTo(Math.PI * 9, 0);
  });

  it.each(HOLE_KINDS)('%s: the box holds the footprint exactly', (kind) => {
    const b = bounds([holeFootprint(hole(kind))]);
    const box = holeBox(hole(kind));
    for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) expect(b[key]).toBeCloseTo(box[key], 6);
  });

  it('a stadium runs between its ends', () => {
    const b = bounds([stadium([0, 0], [0, 10], 2)]);
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([-2, 2, -2, 12]);
  });
});

describe('placePoint', () => {
  it('turns counter-clockwise, then moves', () => {
    const p = placePoint({ x: 10, y: 5, rotation: 90 }, [2, 0]);
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBeCloseTo(7);
  });
});

describe('keyholes', () => {
  it('need about 5 mm for an M4 head', () => {
    expect(keyholeMinThickness(hole('keyhole'))).toBeCloseTo(5.3);
  });

  it('cut from the back and stay under the front face', () => {
    const cutters = holeCutters(hole('keyhole'), 6, 6);
    for (const c of cutters) {
      if (c.kind !== 'prism') throw new Error(c.kind);
      expect(c.z0).toBeLessThan(2);
      expect(c.z1).toBeLessThan(6);
    }
  });
});

describe('through holes', () => {
  it('reach past both faces and the relief', () => {
    for (const kind of ['round', 'slot'] as const) {
      const [cutter] = holeCutters(hole(kind), 3, 8);
      if (cutter?.kind !== 'prism') throw new Error('not a prism');
      expect(cutter.z0).toBeLessThan(0);
      expect(cutter.z1).toBeGreaterThan(8);
    }
  });

  it('a countersink opens the top of the base with a 90° cone', () => {
    const [cutter] = holeCutters(hole('countersunk', { x: 5 }), 4, 4);
    if (cutter?.kind !== 'revolve') throw new Error('not a solid of revolution');
    expect(cutter.x).toBe(5);
    // the cone: from the shaft at T − (head − screw)/2 to the head at T
    expect(cutter.profile.slice(2, 4)).toEqual([
      [2.25, 2],
      [4.25, 4],
    ]);
    expect(ringArea(cutter.profile)).toBeGreaterThan(0);
  });
});
