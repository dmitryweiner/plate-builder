// Elements as the 2D editor sees them: a box in the element's own frame,
// hit testing, and uniform scaling of its size parameters. Pure: no DOM.

import { holeBox, holeFootprint, placePoint } from '../geo/holes';
import type { Bounds, Point } from '../geo/outline';
import { RANGES, type HoleKind, type PlateElement, type PlateState, type Range } from '../geo/state';
import { pointInRings } from '../geo/warnings';

/** Every element of the state in drawing order: images under texts under holes. */
export function allElements(state: PlateState): PlateElement[] {
  return [...state.images, ...state.texts, ...state.holes];
}

export function findElement(state: PlateState, id: string | null): PlateElement | null {
  return allElements(state).find((e) => e.id === id) ?? null;
}

/** Replaces an element of the state by id. */
export function replaceElement(state: PlateState, next: PlateElement): PlateState {
  if (next.type === 'image') return { ...state, images: state.images.map((e) => (e.id === next.id ? next : e)) };
  if (next.type === 'text') return { ...state, texts: state.texts.map((e) => (e.id === next.id ? next : e)) };
  return { ...state, holes: state.holes.map((e) => (e.id === next.id ? next : e)) };
}

/**
 * The element's box in its own frame (before rotation, around its
 * position). A text's box is estimated from its size until its raster is
 * measured (M4).
 */
export function elementBox(e: PlateElement): Bounds {
  if (e.type === 'hole') return holeBox(e);
  if (e.type === 'image') {
    const long = Math.max(e.pixelWidth, e.pixelHeight);
    const w = (e.size * e.pixelWidth) / long;
    const h = (e.size * e.pixelHeight) / long;
    return { minX: -w / 2, maxX: w / 2, minY: -h / 2, maxY: h / 2 };
  }
  const lines = e.text.split('\n');
  const w = 0.7 * e.size * Math.max(1, ...lines.map((line) => line.length));
  const h = e.size * (1 + (lines.length - 1) * e.lineSpacing);
  return { minX: -w / 2, maxX: w / 2, minY: -h / 2, maxY: h / 2 };
}

/** The box's corners in the plate frame, counter-clockwise from the bottom left of the element's frame. */
export function boxCorners(e: PlateElement): [Point, Point, Point, Point] {
  const b = elementBox(e);
  return [
    placePoint(e, [b.minX, b.minY]),
    placePoint(e, [b.maxX, b.minY]),
    placePoint(e, [b.maxX, b.maxY]),
    placePoint(e, [b.minX, b.maxY]),
  ];
}

/** The plate point in the element's own frame. */
export function toLocal(e: { x: number; y: number; rotation: number }, [x, y]: Readonly<Point>): Point {
  const a = (-e.rotation * Math.PI) / 180;
  const dx = x - e.x;
  const dy = y - e.y;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Whether a plate point hits the element: a hole by its shape, the rest by their box; `slop` mm of tolerance around a box. */
export function hitsElement(e: PlateElement, p: Readonly<Point>, slop = 0): boolean {
  const local = toLocal(e, p);
  const b = elementBox(e);
  const inBox = local[0] >= b.minX - slop && local[0] <= b.maxX + slop && local[1] >= b.minY - slop && local[1] <= b.maxY + slop;
  if (e.type !== 'hole' || !inBox) return inBox;
  return slop > 0 || pointInRings(local, [holeFootprint(e)]);
}

/** The topmost visible element under a plate point. */
export function hitTest(state: PlateState, p: Readonly<Point>, slop = 0): PlateElement | null {
  const elements = allElements(state).filter((e) => e.visible);
  for (let i = elements.length - 1; i >= 0; i--) if (hitsElement(elements[i], p, slop)) return elements[i];
  return null;
}

type Sizes = { key: string; range: Range }[];

const HOLE_SIZES: Record<HoleKind, Sizes> = {
  round: [{ key: 'diameter', range: RANGES.holeDiameter }],
  slot: [
    { key: 'length', range: RANGES.slotLength },
    { key: 'width', range: RANGES.slotWidth },
  ],
  countersunk: [
    { key: 'screw', range: RANGES.screw },
    { key: 'head', range: RANGES.screwHead },
  ],
  keyhole: [
    { key: 'keyHead', range: RANGES.keyHead },
    { key: 'keyShank', range: RANGES.keyShank },
    { key: 'keySlot', range: RANGES.keySlot },
  ],
};

/** The parameters a uniform scale multiplies, with their ranges. */
function sizeParams(e: PlateElement): Sizes {
  if (e.type === 'image') return [{ key: 'size', range: RANGES.imageSize }];
  if (e.type === 'text') return [{ key: 'size', range: RANGES.textSize }];
  return HOLE_SIZES[e.kind];
}

const read = (e: PlateElement, key: string): number => {
  const value: unknown = Object.entries(e).find(([k]) => k === key)?.[1];
  return typeof value === 'number' ? value : 1;
};

/**
 * Scales an element's size parameters together by `factor`, held to their
 * ranges so the shape keeps its proportions. Returns the element and the
 * factor actually applied.
 */
export function scaleElement<E extends PlateElement>(e: E, factor: number): { element: E; factor: number } {
  const params = sizeParams(e);
  let f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  for (const { key, range } of params) {
    const value = read(e, key);
    f = Math.min(Math.max(f, range.min / value), range.max / value);
  }
  const scaled = Object.fromEntries(params.map(({ key }) => [key, read(e, key) * f]));
  return { element: { ...e, ...scaled }, factor: f };
}
