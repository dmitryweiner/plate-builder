// Magnets (spec §5a) as plain data: where a layout puts them on the
// outline, their pockets' footprints for the 2D view and the warnings, and
// their cutters for the worker. No CSG here.
//
// A glued magnet's pocket is open at the back, the magnet flush with it. A
// sealed one's is a closed void over `cover` mm of the plate, its ceiling
// on a layer boundary: the print pauses there, the magnets go in, and the
// next layer closes them.
//
// The 2D view and the worker both place the magnets with magnetPositions,
// on the outline each of them has, so the two agree.

import { circle, CUT_OVERSHOOT, type Cutter } from './holes';
import { bounds, distanceToRings, pointInRings, type Point, type Ring } from './outline';
import type { MagnetLayout, Magnets } from './state';

/** How much deeper a pocket is than its magnet: room for glue, while the magnet stays flush with the back. */
export const MAGNET_DEPTH_FIT = 0.1;
/** Material a pocket leaves at the front, mm (as a keyhole's). */
export const MAGNET_SKIN = 0.8;
/** How far apart each magnet's pocket top is from the next's, so no two cutters share a plane: a micron. */
const MAGNET_JITTER = 0.001;
/** The usual printed layer, mm: a sealed pocket's ceiling lies on a multiple of it, where the print pauses. */
export const MAGNET_LAYER = 0.2;

const hundredth = (value: number) => Math.round(value * 100) / 100;

type PocketSizes = Pick<Magnets, 'diameter' | 'thickness' | 'fit' | 'mount' | 'cover'>;

export interface MagnetPocket {
  radius: number;
  /** from the floor to the ceiling */
  depth: number;
  /** above the back face: 0 for a glued magnet's, the cover for a sealed one's */
  floor: number;
  ceiling: number;
}

export function magnetPocket(m: PocketSizes): MagnetPocket {
  const radius = hundredth((m.diameter + m.fit) / 2);
  const fitted = m.thickness + MAGNET_DEPTH_FIT;
  if (m.mount === 'glued') return { radius, depth: hundredth(fitted), floor: 0, ceiling: hundredth(fitted) };
  // up to the next layer boundary; a micron of slack, since 2.6 / 0.2 is 13.000000000000002
  const ceiling = hundredth(Math.ceil((m.cover + fitted) / MAGNET_LAYER - 1e-6) * MAGNET_LAYER);
  return { radius, depth: hundredth(ceiling - m.cover), floor: m.cover, ceiling };
}

/** The thickness the pockets need under the front skin (warning `magnet.thin`). */
export function magnetMinThickness(m: PocketSizes): number {
  return hundredth(magnetPocket(m).ceiling + MAGNET_SKIN);
}

/** Evenly from −1 to 1. */
const spread = (n: number): number[] => Array.from({ length: n }, (_, k) => -1 + (2 * k) / (n - 1));

/** A layout's anchors in the inset box, −1…1 both ways, y up; in the order of the layout's name. */
function anchors(layout: MagnetLayout, count: number): Point[] {
  const all: Record<MagnetLayout, () => Point[]> = {
    centre: () => [[0, 0]],
    top: () => [[0, 1]],
    row: () => spread(count).map((u): Point => [u, 0]),
    column: () => spread(count).map((v): Point => [0, -v]),
    topCorners: () => [
      [-1, 1],
      [1, 1],
    ],
    triangle: () => [
      [0, 1],
      [-1, -1],
      [1, -1],
    ],
    triangleDown: () => [
      [-1, 1],
      [1, 1],
      [0, -1],
    ],
    corners: () => [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ],
    diamond: () => [
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ],
  };
  return all[layout]();
}

export interface MagnetSpot {
  x: number;
  y: number;
  /** the pocket keeps its edge from the outline here */
  fits: boolean;
}

/** Steps of the walk from an anchor towards the middle, then halvings of the last step. */
const STEPS = 64;
const HALVINGS = 20;

/**
 * Where the magnets go: the layout's anchors in the outline's box, inset by
 * the pocket's radius and the edge. An anchor whose pocket would come closer
 * than the edge to the outline (a circle's corner, a heart's) slides towards
 * the box's middle until it fits; one that never does stays put, not fitting.
 * The edge is counted from the foot of the plate's rounded or chamfered
 * bottom edge (`edgeSize` in from the outline), so a pocket never opens into it.
 */
export function magnetPositions(m: Magnets, outline: readonly Ring[], edgeSize = 0): MagnetSpot[] {
  if (m.count === 0) return [];
  const points = anchors(m.layout, m.count);
  if (!outline.some((ring) => ring.length > 0)) return points.map(() => ({ x: 0, y: 0, fits: false }));
  const keep = magnetPocket(m).radius + m.edge + edgeSize;
  const box = bounds(outline);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const hx = Math.max(0, (box.maxX - box.minX) / 2 - keep);
  const hy = Math.max(0, (box.maxY - box.minY) / 2 - keep);
  // a micron of slack: on a straight side the inset corner is exactly `keep` away
  const fits = (p: Point) => pointInRings(p, outline) && distanceToRings(p, outline) >= keep - 1e-6;
  return points.map(([u, v]) => {
    const at = (t: number): Point => [cx + t * u * hx, cy + t * v * hy];
    if (fits(at(1))) return spot(at(1), true);
    // the first step towards the middle that fits, then closer to the anchor by halving
    let k = STEPS - 1;
    while (k >= 0 && !fits(at(k / STEPS))) k--;
    if (k < 0) return spot(at(1), false);
    let lo = k / STEPS;
    let hi = (k + 1) / STEPS;
    for (let i = 0; i < HALVINGS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(at(mid))) lo = mid;
      else hi = mid;
    }
    return spot(at(lo), true);
  });
}

/** `+ 0`: no −0 in a position. */
const spot = ([x, y]: Point, fits: boolean): MagnetSpot => ({ x: x + 0, y: y + 0, fits });

/** Each pocket as seen from the back, plate frame. */
export function magnetFootprints(m: Magnets, outline: readonly Ring[], edgeSize = 0): Ring[] {
  const { radius } = magnetPocket(m);
  return magnetPositions(m, outline, edgeSize).map(({ x, y }) => circle(x, y, radius));
}

/** The pockets' cutters: from under the back face (glued) or from the cover (sealed) up to the ceiling. */
export function magnetCutters(m: Magnets, outline: readonly Ring[], edgeSize = 0): Cutter[] {
  const { floor, ceiling } = magnetPocket(m);
  return magnetFootprints(m, outline, edgeSize).map((ring, i) => ({
    kind: 'prism',
    rings: [ring],
    z0: m.mount === 'glued' ? -CUT_OVERSHOOT : floor - (i + 1) * MAGNET_JITTER,
    z1: ceiling + (i + 1) * MAGNET_JITTER,
  }));
}
