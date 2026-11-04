// Holes (spec §5) as plain data: their footprints for the 2D view, hit
// tests and warnings, and their cutters for the worker. No CSG here.
//
// Local frames: a slot lies along x at rotation 0; a keyhole's entry hole is
// at the element's position and its slot runs up (+y) from it at rotation 0
// — the plate hangs down from the screw.

import { segmentsFor, type Bounds, type Point, type Ring } from './outline';
import type { HoleElement, HoleKind } from './state';

/** Material under a keyhole's channel at the back (the lip the screw head holds), mm. */
export const KEYHOLE_LIP = 1.5;
/** Material left over the channel at the front, mm. */
export const KEYHOLE_SKIN = 0.8;
/** Cutters reach this far past the faces they open, so no face of theirs lies on the plate's. */
export const CUT_OVERSHOOT = 1;
/** How far a hole's own cutters overlap each other, so no two share a face: too little to see or print. */
export const CUT_EPS = 0.01;

/** The channel's height: a pan head is about 0.6 d high, plus room to slide. */
export function keyholePocket(hole: Pick<HoleElement, 'keyShank'>): number {
  return 0.6 * hole.keyShank + 0.6;
}

/** The thickness a hidden keyhole needs (warning `keyhole.thin`). */
export function keyholeMinThickness(hole: Pick<HoleElement, 'keyShank'>): number {
  return Math.round((KEYHOLE_LIP + keyholePocket(hole) + KEYHOLE_SKIN) * 10) / 10;
}

export function circle(cx: number, cy: number, r: number): Ring {
  const n = segmentsFor(r);
  return Array.from({ length: n }, (_, k): Point => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]);
}

/** A stadium: the points within r of the segment a–b, counter-clockwise. */
export function stadium(a: Readonly<Point>, b: Readonly<Point>, r: number): Ring {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-9) return circle(a[0], a[1], r);
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const half = Math.max(2, segmentsFor(r) / 2);
  const ring: Ring = [];
  // around b from −90° to +90°, then around a from +90° to +270°
  for (let k = 0; k <= half; k++) {
    const t = angle - Math.PI / 2 + (Math.PI * k) / half;
    ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  for (let k = 0; k <= half; k++) {
    const t = angle + Math.PI / 2 + (Math.PI * k) / half;
    ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  return ring;
}

/** A slot's centre line ends, local frame: its length is tip to tip, never less than its width. */
function slotEnds(hole: Pick<HoleElement, 'length' | 'width'>): [Point, Point] {
  const half = Math.max(0, hole.length - hole.width) / 2;
  return [
    [-half, 0],
    [half, 0],
  ];
}

/** From the local frame of an element to the plate frame. */
export function placePoint(e: { x: number; y: number; rotation: number }, [x, y]: Readonly<Point>): Point {
  const a = (e.rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [e.x + x * c - y * s, e.y + x * s + y * c];
}

export const placeRing = (e: { x: number; y: number; rotation: number }, ring: Ring): Ring => ring.map((p) => placePoint(e, p));

/**
 * What the hole takes out of the plate as seen from the front, local frame:
 * the widest opening (a countersink's head, a keyhole's channel — hidden
 * behind the front skin, but it is where the material goes).
 */
export function holeFootprint(hole: HoleElement): Ring {
  const shapes: Record<HoleKind, () => Ring> = {
    round: () => circle(0, 0, hole.diameter / 2),
    slot: () => {
      const [a, b] = slotEnds(hole);
      return stadium(a, b, hole.width / 2);
    },
    countersunk: () => circle(0, 0, hole.head / 2),
    keyhole: () => stadium([0, 0], [0, hole.keySlot], hole.keyHead / 2),
  };
  return shapes[hole.kind]();
}

/** The local box of a hole: the selection box of the 2D view. */
const square = (side: number): Bounds => ({ minX: -side / 2, maxX: side / 2, minY: -side / 2, maxY: side / 2 });

export function holeBox(hole: HoleElement): Bounds {
  const boxes: Record<HoleKind, () => Bounds> = {
    round: () => square(hole.diameter),
    slot: () => {
      const half = Math.max(hole.length, hole.width) / 2;
      return { minX: -half, maxX: half, minY: -hole.width / 2, maxY: hole.width / 2 };
    },
    countersunk: () => square(hole.head),
    keyhole: () => ({ minX: -hole.keyHead / 2, maxX: hole.keyHead / 2, minY: -hole.keyHead / 2, maxY: hole.keySlot + hole.keyHead / 2 }),
  };
  return boxes[hole.kind]();
}

/**
 * A cutter in the plate frame: a prism of rings between two heights, or a
 * solid of revolution about a vertical axis at (x, y) given by its profile
 * of (radius, z) points, counter-clockwise, the axis being r = 0.
 */
export type Cutter = { kind: 'prism'; rings: Ring[]; z0: number; z1: number } | { kind: 'revolve'; x: number; y: number; profile: Point[] };

/**
 * The cutters of a hole on a plate of thickness `thickness` whose relief
 * reaches `top`. Through cuts overshoot both faces; internal levels are off
 * by CUT_EPS so that no two cutters, and no cutter and the base, share a
 * plane.
 */
export function holeCutters(hole: HoleElement, thickness: number, top: number): Cutter[] {
  const below = -CUT_OVERSHOOT;
  const above = top + CUT_OVERSHOOT;
  const prism = (ring: Ring, z0: number, z1: number): Cutter => ({ kind: 'prism', rings: [placeRing(hole, ring)], z0, z1 });
  const cutters: Record<HoleKind, () => Cutter[]> = {
    round: () => [prism(holeFootprint(hole), below, above)],
    slot: () => [prism(holeFootprint(hole), below, above)],
    countersunk: () => {
      // one solid of revolution: the screw's shaft, a 90° cone (the radius
      // grows by as much as the height) up to the base's top, the head's room above
      const r0 = hole.screw / 2;
      const r1 = hole.head / 2;
      const coneBottom = thickness - (r1 - r0);
      return [
        {
          kind: 'revolve',
          x: hole.x,
          y: hole.y,
          profile: [
            [0, below],
            [r0, below],
            [r0, coneBottom],
            [r1, thickness],
            [r1, above],
            [0, above],
          ],
        },
      ];
    },
    keyhole: () => {
      const pocketTop = KEYHOLE_LIP + keyholePocket(hole);
      return [
        // the entry hole, from the back up to the channel's ceiling
        prism(circle(0, 0, hole.keyHead / 2), below, pocketTop),
        // the slot for the shank through the lip, into the channel
        prism(stadium([0, 0], [0, hole.keySlot], hole.keyShank / 2), below, KEYHOLE_LIP + CUT_EPS),
        // the channel the head slides along, behind the lip
        prism(stadium([0, 0], [0, hole.keySlot], hole.keyHead / 2), KEYHOLE_LIP, pocketTop - CUT_EPS),
      ];
    },
  };
  return cutters[hole.kind]();
}
