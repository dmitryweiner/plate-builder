// The plate's outer top and bottom edges (spec §2.2a) as plain data: the
// profile, its terraces and the cores the worker intersects the solid with.
// No CSG here.
//
// At a distance t from the back face (or from the wall's top) the plate's
// section is the outline shrunk by the profile's inset at t. The profile is
// built from terraces: n slabs, each the outline shrunk by the profile's
// inset at the slab's middle. Arbitrary outlines rule out a smooth loft
// between the shrunk outlines (shrinking changes a ring's vertex count and
// topology), and the slabs are as thin as a printed layer.
//
// The solid is kept inside the union of n nested cores: core k is the
// outline shrunk by slab k's inset, over the heights where the profile
// shrinks it no more than that. Each core has its own walls and its own
// heights, so no two share a plane by construction.

import { CUT_OVERSHOOT } from './holes';
import { wallHeight, type EdgeProfile, type Plate } from './state';

/** The longest piece of the profile between two terraces, mm: a preview's, an export's (a printed layer's scale). */
export const EDGE_STEP = { preview: 0.5, export: 0.1 } as const;
const LEVELS_MIN = 4;
const LEVELS_MAX = 48;
/**
 * How far every core's heights and walls are moved off the profile's, mm:
 * a chamfer's terraces are round fractions that would otherwise fall on T,
 * a rim's width or a keyhole's lip.
 */
export const EDGE_JITTER = 0.0023;

/** The profile's inset at the distance t from the edge's face: r at the face, 0 at t ≥ r. */
export function edgeInset(size: number, profile: EdgeProfile, t: number): number {
  const d = Math.min(Math.max(t, 0), size);
  if (profile === 'chamfer') return size - d;
  // the circle's centre is at (inset r, t r)
  return size - Math.sqrt(Math.max(0, size * size - (size - d) ** 2));
}

export interface EdgeLevel {
  /** the slab's end, from the edge's face, mm */
  t: number;
  /** the outline shrunk by this much within the slab, mm */
  inset: number;
}

/**
 * The terraces of one edge, from its face inwards: a fillet's uniform in
 * angle, a chamfer's uniform in height, each piece of the profile at most
 * `step` long.
 */
export function edgeLevels(size: number, profile: EdgeProfile, step: number): EdgeLevel[] {
  if (size <= 0) return [];
  const length = profile === 'fillet' ? (size * Math.PI) / 2 : size * Math.SQRT2;
  const n = Math.min(LEVELS_MAX, Math.max(LEVELS_MIN, Math.ceil(length / step - 1e-9)));
  return Array.from({ length: n }, (_, k): EdgeLevel => {
    if (profile === 'chamfer') return { t: (size * (k + 1)) / n, inset: size * (1 - (k + 0.5) / n) };
    const end = ((k + 1) / n) * (Math.PI / 2);
    const mid = ((k + 0.5) / n) * (Math.PI / 2);
    return { t: size * (1 - Math.cos(end)), inset: size * (1 - Math.sin(mid)) };
  });
}

export interface EdgeCore {
  inset: number;
  z0: number;
  z1: number;
}

/**
 * The nested cores the solid is kept inside, widest-in-height first: the
 * first runs from below the back face to above `top` (it trims what stands
 * over the wall too), core k from the end of slab k − 1 at the bottom to its
 * mirror at the wall's top.
 */
export function edgeCores(plate: Plate, step: number, top: number): EdgeCore[] {
  const levels = edgeLevels(plate.edgeSize, plate.edgeProfile, step);
  const wall = wallHeight(plate);
  return levels.map(({ inset }, k): EdgeCore => {
    if (k === 0) return { inset: inset + EDGE_JITTER, z0: -CUT_OVERSHOOT, z1: top + 1 };
    const t = levels[k - 1].t + EDGE_JITTER;
    return { inset: inset + EDGE_JITTER, z0: t, z1: wall - t };
  });
}
