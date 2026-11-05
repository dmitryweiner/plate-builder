import { describe, expect, it } from 'vitest';
import { circle, CUT_OVERSHOOT } from './holes';
import { magnetCutters, magnetFootprints, magnetMinThickness, magnetPocket, magnetPositions, MAGNET_SKIN } from './magnets';
import { distanceToRings, primitiveOutline, type Ring } from './outline';
import { defaultMagnets, defaultState, magnetLayouts, type MagnetLayout, type Magnets } from './state';

const rectangle = (width: number, height: number): Ring[] => [
  primitiveOutline({ ...defaultState().plate, kind: 'rectangle', width, height }),
];
const plate = rectangle(100, 60);
const magnets = (over: Partial<Magnets>): Magnets => ({ ...defaultMagnets(), count: 1, ...over });
const spots = (over: Partial<Magnets>, outline: Ring[] = plate) =>
  magnetPositions(magnets(over), outline).map(({ x, y }) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);

// a 10 mm magnet with 0.2 of fit is a 5.1 mm radius; with 3 mm of edge its centre keeps 8.1 from the outline
const X = 50 - 8.1;
const Y = 30 - 8.1;

describe('magnet pockets', () => {
  it('are the magnet with its fit across and 0.1 mm deeper than it, so it sits flush', () => {
    expect(magnetPocket(defaultMagnets())).toEqual({ radius: 5.1, depth: 2.1 });
    expect(magnetPocket({ ...defaultMagnets(), diameter: 12, thickness: 3, fit: 0 })).toEqual({ radius: 6, depth: 3.1 });
  });

  it('need the pocket and a front skin of 0.8 mm', () => {
    expect(MAGNET_SKIN).toBe(0.8);
    expect(magnetMinThickness(defaultMagnets())).toBe(2.9);
    expect(magnetMinThickness({ ...defaultMagnets(), thickness: 5 })).toBe(5.9);
  });
});

describe('magnet positions', () => {
  it('are none without magnets', () => {
    expect(magnetPositions(magnets({ count: 0 }), plate)).toEqual([]);
  });

  it.each<[number, MagnetLayout, number[][]]>([
    [1, 'centre', [[0, 0]]],
    [1, 'top', [[0, Y]]],
    [
      2,
      'row',
      [
        [-X, 0],
        [X, 0],
      ],
    ],
    [
      2,
      'column',
      [
        [0, Y],
        [0, -Y],
      ],
    ],
    [
      2,
      'topCorners',
      [
        [-X, Y],
        [X, Y],
      ],
    ],
    [
      3,
      'triangle',
      [
        [0, Y],
        [-X, -Y],
        [X, -Y],
      ],
    ],
    [
      3,
      'triangleDown',
      [
        [-X, Y],
        [X, Y],
        [0, -Y],
      ],
    ],
    [
      3,
      'row',
      [
        [-X, 0],
        [0, 0],
        [X, 0],
      ],
    ],
    [
      4,
      'corners',
      [
        [-X, Y],
        [X, Y],
        [-X, -Y],
        [X, -Y],
      ],
    ],
    [
      4,
      'diamond',
      [
        [0, Y],
        [-X, 0],
        [X, 0],
        [0, -Y],
      ],
    ],
    [
      4,
      'column',
      [
        [0, Y],
        [0, Y / 3],
        [0, -Y / 3],
        [0, -Y],
      ],
    ],
  ])('%i in a %s on a rectangle keep the edge from its sides', (count, layout, expected) => {
    const round = expected.map((p) => p.map((v) => Math.round(v * 1000) / 1000 + 0));
    expect(spots({ count, layout })).toEqual(round);
    expect(magnetPositions(magnets({ count, layout }), plate).every((spot) => spot.fits)).toBe(true);
  });

  it('every layout of every count gives that many magnets', () => {
    for (let count = 1; count <= 4; count++) {
      for (const layout of magnetLayouts(count)) expect(magnetPositions(magnets({ count, layout }), plate)).toHaveLength(count);
    }
  });

  it('follow the edge setting', () => {
    expect(spots({ count: 2, layout: 'row', edge: 10 })).toEqual([
      [-(50 - 15.1), 0],
      [50 - 15.1, 0],
    ]);
  });

  it('centre on the outline, wherever it is (a crop)', () => {
    const shifted = plate.map((ring) => ring.map(([x, y]): [number, number] => [x + 20, y - 10]));
    expect(spots({ count: 1, layout: 'centre' }, shifted)).toEqual([[20, -10]]);
  });

  it('slide towards the middle where a corner is outside the outline (a circle)', () => {
    const disc = [circle(0, 0, 30)];
    const placed = magnetPositions(magnets({ count: 4, layout: 'corners' }), disc);
    for (const spot of placed) {
      expect(spot.fits).toBe(true);
      // on the diagonal, the pocket 3 mm from the rim
      expect(Math.abs(spot.x)).toBeCloseTo(Math.abs(spot.y), 6);
      expect(Math.hypot(spot.x, spot.y)).toBeCloseTo(30 - 8.1, 1);
      expect(distanceToRings([spot.x, spot.y], disc)).toBeGreaterThanOrEqual(8.1 - 1e-6);
    }
  });

  it('say when a pocket does not fit even in the middle', () => {
    const [spot] = magnetPositions(magnets({ count: 1, layout: 'centre' }), rectangle(15, 15));
    expect(spot).toEqual({ x: 0, y: 0, fits: false });
  });

  it('have nowhere to go on an empty outline', () => {
    expect(magnetPositions(magnets({ count: 2, layout: 'row' }), [])).toEqual([
      { x: 0, y: 0, fits: false },
      { x: 0, y: 0, fits: false },
    ]);
  });
});

describe('magnet footprints and cutters', () => {
  it('are a circle of the pocket at each magnet', () => {
    const [footprint] = magnetFootprints(magnets({ count: 1, layout: 'top' }), plate);
    const xs = footprint.map(([x]) => x);
    const ys = footprint.map(([, y]) => y);
    expect(Math.max(...xs)).toBeCloseTo(5.1);
    expect(Math.min(...ys)).toBeCloseTo(Y - 5.1);
  });

  it('cut from below the back face to the pocket depth, a few microns apart so no two share a plane', () => {
    const cutters = magnetCutters(magnets({ count: 4, layout: 'corners' }), plate);
    expect(cutters).toHaveLength(4);
    const tops = cutters.map((c) => (c.kind === 'prism' ? c.z1 : NaN));
    for (const c of cutters) expect(c.kind === 'prism' && c.z0).toBe(-CUT_OVERSHOOT);
    expect(new Set(tops).size).toBe(4);
    for (const top of tops) {
      expect(top).toBeGreaterThan(2.1);
      expect(top).toBeLessThan(2.1 + 0.01);
    }
  });

  it('are none without magnets', () => {
    expect(magnetCutters(magnets({ count: 0 }), plate)).toEqual([]);
  });
});
