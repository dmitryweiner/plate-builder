import { describe, expect, it } from 'vitest';
import { primitiveOutline } from './outline';
import { defaultHole, defaultState, type HoleElement, type PlateState } from './state';
import { pointInRings, ringsDistance, ringsOverlap, warnings } from './warnings';

/** A 100 × 60 rectangle, 3 mm thick, with the given holes. */
function plate(holes: Partial<HoleElement>[], thickness = 3): PlateState {
  const state = defaultState();
  return {
    ...state,
    plate: { ...state.plate, width: 100, height: 60, thickness, rounding: 0 },
    holes: holes.map((over, i) => ({ ...defaultHole('round'), id: `h${i + 1}`, ...over })),
  };
}
const outline = [primitiveOutline({ ...defaultState().plate, kind: 'rectangle', width: 100, height: 60 })];
const codes = (state: PlateState) => warnings(state, outline).map((w) => w.code);

function square(x: number, y: number, s: number): [number, number][] {
  return [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
}

describe('geometry helpers', () => {
  it('tells inside from outside, holes of the rings included', () => {
    expect(pointInRings([5, 5], [square(0, 0, 10)])).toBe(true);
    expect(pointInRings([15, 5], [square(0, 0, 10)])).toBe(false);
    expect(pointInRings([5, 5], [square(0, 0, 10), square(4, 4, 2).toReversed()])).toBe(false);
  });

  it('measures the gap between rings', () => {
    expect(ringsDistance(square(0, 0, 10), [square(13, 0, 5)])).toBeCloseTo(3);
    expect(ringsDistance(square(0, 0, 10), [square(12, 12, 5)])).toBeCloseTo(Math.SQRT2 * 2);
  });

  it('finds overlaps: crossing edges or one inside the other', () => {
    expect(ringsOverlap(square(0, 0, 10), square(5, 5, 10))).toBe(true);
    expect(ringsOverlap(square(0, 0, 10), square(2, 2, 2))).toBe(true);
    expect(ringsOverlap(square(2, 2, 2), square(0, 0, 10))).toBe(true);
    expect(ringsOverlap(square(0, 0, 10), square(11, 0, 2))).toBe(false);
  });
});

describe('warnings', () => {
  it('has none for a plain plate and a hole well inside it', () => {
    expect(codes(plate([]))).toEqual([]);
    expect(codes(plate([{ x: 0, y: 0 }]))).toEqual([]);
  });

  it('hole.nearEdge: less than 2 mm of material to the outline, not at 2.1', () => {
    // a 4 mm hole at x = 46: 2 mm from its edge to the plate's at 50
    expect(codes(plate([{ x: 46.1 }]))).toEqual(['hole.nearEdge']);
    expect(codes(plate([{ x: 43.9 }]))).toEqual([]);
    const [w] = warnings(plate([{ x: 46.5 }]), outline);
    expect(w).toMatchObject({ code: 'hole.nearEdge', ids: ['h1'], params: { distance: 1.5 } });
    expect(w?.spot[0]).toBeCloseTo(46.5);
  });

  it('element.outside: a hole that pokes out of the outline', () => {
    expect(codes(plate([{ x: 49 }]))).toEqual(['element.outside']);
    expect(codes(plate([{ x: 49, visible: false }]))).toEqual([]);
  });

  it('element.overlap: two holes that touch, not two a hair apart', () => {
    expect(codes(plate([{ x: 0 }, { x: 3.9 }]))).toEqual(['element.overlap']);
    expect(codes(plate([{ x: 0 }, { x: 4.1 }]))).toEqual([]);
    expect(warnings(plate([{ x: 0 }, { x: 3 }]), outline)[0]).toMatchObject({ ids: ['h1', 'h2'], spot: [1.5, 0] });
  });

  it('keyhole.thin: with the thickness needed', () => {
    const [w] = warnings(plate([{ kind: 'keyhole' }], 4), outline);
    expect(w).toMatchObject({ code: 'keyhole.thin', ids: ['h1'], params: { needed: 5.3 } });
    expect(codes(plate([{ kind: 'keyhole' }], 5.3))).toEqual([]);
  });

  it('checks a turned slot by its real footprint', () => {
    // 20 long, 4 wide: along x its end is 10 from the centre, turned 90° only 2
    expect(codes(plate([{ kind: 'slot', length: 20, width: 4, x: 41 }]))).toEqual(['element.outside']);
    expect(codes(plate([{ kind: 'slot', length: 20, width: 4, x: 41, rotation: 90 }]))).toEqual([]);
  });
});
