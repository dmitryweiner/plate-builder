import { describe, expect, it } from 'vitest';
import { boxCorners } from './boxes';
import { pointInRings, primitiveOutline } from './outline';
import {
  defaultHole,
  defaultImage,
  defaultState,
  defaultText,
  type HoleElement,
  type ImageElement,
  type Magnets,
  type PlateState,
  type TextElement,
} from './state';
import { ringsDistance, ringsOverlap, warnings } from './warnings';

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

const withText = (text: Partial<TextElement>, extra: Partial<PlateState> = {}): PlateState => {
  const state = plate([]);
  return { ...state, texts: [{ ...defaultText(state), id: 't1', ...text }], ...extra };
};
const image = (over: Partial<ImageElement>): ImageElement => ({
  ...defaultImage(defaultState(), 'data:image/png;base64,', 10, 10),
  id: 'i1',
  size: 20,
  ...over,
});

function edged(y: number, edgeSize: number): PlateState {
  const state = withText({ y });
  return { ...state, plate: { ...state.plate, edgeSize } };
}

describe('warnings of texts and images', () => {
  it('text.arcLines: an arc text of several lines, not one line or a straight block', () => {
    expect(codes(withText({ arc: true, text: 'a\nb' }))).toEqual(['text.arcLines']);
    expect(codes(withText({ arc: true, text: 'ab' }))).toEqual([]);
    expect(codes(withText({ arc: false, text: 'a\nb' }))).toEqual([]);
  });

  it('text.onEdge: a text within the rounded edge’s reach of the outline, not one further in', () => {
    const half = Math.max(...boxCorners({ ...defaultText(defaultState()), id: 't1' }).map(([, y]) => y));
    // the box's top 1 mm from the plate's side at y = 30
    expect(warnings(edged(29 - half, 1.5), outline)).toEqual([expect.objectContaining({ code: 'text.onEdge', ids: ['t1'] })]);
    expect(codes(edged(29 - half, 0.9))).toEqual([]);
    expect(codes(edged(29 - half, 0))).toEqual([]);
    expect(codes(edged(0, 1.5))).toEqual([]);
  });

  it('text.buried: a raised text lower than an image under it', () => {
    expect(codes(withText({ height: 1 }, { images: [image({ height: 2 })] }))).toEqual(['text.buried']);
    expect(codes(withText({ height: 2.5 }, { images: [image({ height: 2 })] }))).toEqual([]);
    expect(codes(withText({ height: 1, mode: 'engraved' }, { images: [image({ height: 2 })] }))).toEqual([]);
    expect(codes(withText({ height: 1 }, { images: [image({ height: 2, x: 35 })] }))).toEqual([]);
  });

  it('element.overlap: a hole that crosses a text', () => {
    const state = withText({}, { holes: [{ ...defaultHole('round'), id: 'h1', x: 2 }] });
    expect(warnings(state, outline)).toEqual([expect.objectContaining({ code: 'element.overlap', ids: ['h1', 't1'] })]);
  });

  it('element.outside: a text or an image poking out of the outline', () => {
    expect(codes(withText({ x: 48 }))).toEqual(['element.outside']);
    expect(codes({ ...plate([]), images: [image({ y: 25 })] })).toEqual(['element.outside']);
  });

  it('not under a crop, which follows its images and texts', () => {
    const state = { ...plate([]), images: [image({ y: 25 })] };
    expect(codes({ ...state, plate: { ...state.plate, kind: 'crop' } })).toEqual([]);
  });
});

describe('relief.tall', () => {
  it('fires when the relief is more than 3 × T, not at exactly 3 × T', () => {
    const tall = (height: number) => codes({ ...plate([], 2), texts: [{ ...defaultText(defaultState()), id: 't1', height }] });
    expect(tall(6.1)).toEqual(['relief.tall']);
    expect(tall(6)).toEqual([]);
    const rim = plate([], 1);
    expect(codes({ ...rim, plate: { ...rim.plate, rim: true, rimHeight: 3.5 } })).toEqual(['relief.tall']);
  });
});

const withMagnets = (over: Partial<Magnets>, extra: Partial<PlateState> = {}, thickness = 3): PlateState => {
  const state = plate([], thickness);
  return { ...state, magnets: { ...state.magnets, count: 1, ...over }, ...extra };
};

const oneHole = (x: number, visible = true) => ({ holes: [{ ...defaultHole('round'), id: 'h1', x, visible }] });
const oneText = (over: Partial<TextElement>) => ({ texts: [{ ...defaultText(defaultState()), id: 't1', ...over }] });

describe('warnings of magnets', () => {
  it('has none for a 10 × 2 magnet in the middle of a 3 mm plate, or four at the corners', () => {
    expect(codes(withMagnets({}))).toEqual([]);
    expect(codes(withMagnets({ count: 4, layout: 'corners' }))).toEqual([]);
  });

  it('magnet.thin: less than 0.8 mm over a pocket, with the thickness needed', () => {
    const [w] = warnings(withMagnets({ count: 2, layout: 'row' }, {}, 2.5), outline);
    expect(w).toMatchObject({ code: 'magnet.thin', ids: [], params: { needed: 2.9 } });
    expect(w?.spot[0]).toBeCloseTo(-41.9);
    expect(codes(withMagnets({}, {}, 2.9))).toEqual([]);
  });

  it('magnet.noRoom: a pocket that does not fit with its edge, or two too close', () => {
    expect(codes(withMagnets({ diameter: 30, edge: 30 }))).toEqual(['magnet.noRoom']);
    // 30 mm pockets 23.8 mm apart, one over the other
    expect(codes(withMagnets({ count: 4, layout: 'corners', diameter: 30 }))).toEqual(['magnet.noRoom']);
    expect(codes(withMagnets({ count: 2, layout: 'row', diameter: 30 }))).toEqual([]);
  });

  it('magnet.noRoom counts the edge from the foot of the plate’s bottom edge', () => {
    // a 30.2 mm pocket with 14 mm of edge keeps 29.1 of the 30 to the side; 1.5 mm of fillet is too much
    const state = withMagnets({ diameter: 30, edge: 14 });
    expect(codes(state)).toEqual([]);
    expect(codes({ ...state, plate: { ...state.plate, edgeSize: 1.5 } })).toEqual(['magnet.noRoom']);
  });

  it('magnet.overlap: a pocket that crosses a hole, not one beside it', () => {
    expect(warnings(withMagnets({}, oneHole(0)), outline)).toEqual([expect.objectContaining({ code: 'magnet.overlap', ids: ['h1'] })]);
    expect(codes(withMagnets({}, oneHole(10)))).toEqual([]);
    expect(codes(withMagnets({}, oneHole(0, false)))).toEqual([]);
  });

  it('magnet.overlap: an engraving that leaves less than 0.4 mm over a pocket', () => {
    // T 3, the pocket 2.1 deep: an engraving 0.6 deep leaves 0.3
    expect(warnings(withMagnets({}, oneText({ mode: 'engraved', depth: 0.6 })), outline)).toEqual([
      expect.objectContaining({ code: 'magnet.overlap', ids: ['t1'] }),
    ]);
    expect(codes(withMagnets({}, oneText({ mode: 'engraved', depth: 0.5 })))).toEqual([]);
    expect(codes(withMagnets({}, oneText({ mode: 'engraved', depth: 0.6, x: -35 })))).toEqual([]);
    expect(codes(withMagnets({}, oneText({ mode: 'raised' })))).toEqual([]);
  });
});

const withO = (x: number) => ({ ...plate([{ x, diameter: 3 }]), texts: [{ ...defaultText(defaultState()), id: 't1' }] });

describe('a hole and a text’s real ink', () => {
  // a letter O: a 10 mm square ring with a 6 mm counter, around the origin
  const ring: [number, number][][] = [square(-5, -5, 10), square(-3, -3, 6).toReversed()];

  it('a hole in a letter’s counter does not cross the text', () => {
    expect(codes(withO(0))).toEqual(['element.overlap']);
    expect(warnings(withO(0), outline, new Map([['t1', ring]])).map((w) => w.code)).toEqual([]);
  });

  it('a hole on the stroke does', () => {
    expect(warnings(withO(4), outline, new Map([['t1', ring]])).map((w) => w.code)).toEqual(['element.overlap']);
  });
});
