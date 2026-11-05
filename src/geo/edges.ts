// The plate's outer top and bottom edges (spec §2.2a) as plain data: the
// profile, its terraces and the slabs the worker stacks into the plate's
// prism. No CSG here.
//
// At a distance t from the back face (or from the wall's top) the plate's
// section is the outline shrunk by the profile's inset at t. The profile is
// built from terraces: n slabs, each the outline shrunk by the profile's
// inset at the slab's middle. Arbitrary outlines rule out a smooth loft
// between the shrunk outlines (shrinking changes a ring's vertex count and
// topology), and the slabs are as thin as a printed layer.
//
// The worker builds the stack as one mesh, not as a union of prisms: the
// union is slow (every slab's cap is a fan of long triangles that crosses
// every wall of its neighbours). Two neighbours' outlines are then the
// inner and outer rings of the step between them, so they must not touch:
// their insets differ by at least EDGE_MIN_GAP.

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

export interface EdgeSlab {
  inset: number;
  z0: number;
  z1: number;
}

/**
 * The least difference of two neighbouring slabs' insets, mm: more than
 * twice the shrunk outlines' own error (their arcs' chords, CHORD_TOLERANCE,
 * and their simplification), so the two rings never cross.
 */
export const EDGE_MIN_GAP = 0.025;

/**
 * The slabs of the plate's prism up to z1, bottom to top, each ending where
 * the next begins: the bottom edge's terraces from the back face, the wall
 * between the edges (the outline itself, inset 0, unless the edges meet),
 * the top edge's terraces;
 * the last one up to z1 (the wall's top for the base, above the reliefs for
 * the prism that clips them).
 */
export function edgeSlabs(plate: Plate, step: number, z1: number): EdgeSlab[] {
  // terraces closer than the gap are one: near the wall a fillet's insets differ by microns
  const levels: EdgeLevel[] = [];
  for (const level of edgeLevels(plate.edgeSize, plate.edgeProfile, step)) {
    const last = levels.at(-1);
    if (last && last.inset - level.inset < EDGE_MIN_GAP) last.t = level.t;
    else levels.push({ ...level });
  }
  // a terrace closer than the gap to the outline is the wall's: the plate keeps its size
  if ((levels.at(-1)?.inset ?? Infinity) < EDGE_MIN_GAP) levels.pop();
  if (levels.length === 0) return [];
  const wall = wallHeight(plate);
  const ends = levels.map(({ t }) => t + EDGE_JITTER);
  // at the largest size the two edges meet: their last terraces are one slab, and the outline is never reached
  const meet = wall - 2 * (ends.at(-1) ?? 0) < EDGE_MIN_GAP;
  const terraces = meet ? levels.slice(0, -1) : levels;
  const m = terraces.length;
  const middle: EdgeSlab = {
    inset: meet ? levels[levels.length - 1].inset + EDGE_JITTER : 0,
    z0: m === 0 ? 0 : ends[m - 1],
    z1: m === 0 ? z1 : wall - ends[m - 1],
  };
  const bottom = terraces.map(({ inset }, k): EdgeSlab => ({ inset: inset + EDGE_JITTER, z0: k === 0 ? 0 : ends[k - 1], z1: ends[k] }));
  const top = terraces
    .map(({ inset }, k): EdgeSlab => ({ inset: inset + EDGE_JITTER, z0: wall - ends[k], z1: k === 0 ? z1 : wall - ends[k - 1] }))
    .toReversed();
  return [...bottom, middle, ...top];
}
