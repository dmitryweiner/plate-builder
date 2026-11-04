// Marching squares (spec §8.3): an anti-aliased raster → polygons at the
// 50 % level, with linear interpolation along cell edges, so the contours
// are smooth and sub-pixel accurate. Holes are kept; outer rings come out
// counter-clockwise and holes clockwise (y up), so a cross-section takes
// them with the nonzero rule. Then simplified within a quarter pixel.
//
// Coordinates are pixels with y up: pixel (i, j) of row j from the top has
// its centre at (i + 0.5, height − j − 0.5).

import type { Point, Ring } from './outline';

/** Coverage 0–255, row 0 at the top. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export const LEVEL = 127.5;

/** A padded grid node's coordinate in pixels (the padding's nodes lie half a pixel out). */
const node = (k: number) => k - 0.5;

export function traceContours(mask: Mask, tolerance = 0.25): Ring[] {
  const { width, height, data } = mask;
  // the grid of pixel centres, padded with a ring of empty ones so every contour closes
  const gw = width + 2;
  const gh = height + 2;
  const value = (i: number, j: number): number => {
    // i, j: padded grid, j counted from the bottom
    const x = i - 1;
    const row = height - j;
    if (x < 0 || x >= width || row < 0 || row >= height) return 0;
    return data[row * width + x];
  };

  // A crossing on an edge, by the edge's id: horizontal edges from node (i, j) to (i + 1, j),
  // vertical from (i, j) to (i, j + 1).
  const hEdge = (i: number, j: number) => (j * gw + i) * 2;
  const vEdge = (i: number, j: number) => (j * gw + i) * 2 + 1;
  const crossing = (edge: number): Point => {
    const at = edge >> 1;
    const i = at % gw;
    const j = (at - i) / gw;
    const [i1, j1] = edge & 1 ? [i, j + 1] : [i + 1, j];
    const v0 = value(i, j);
    const v1 = value(i1, j1);
    const t = (LEVEL - v0) / (v1 - v0);
    return [node(i) + t * (i1 - i), node(j) + t * (j1 - j)];
  };

  /** segment start edge → end edge; inside lies on the left of each */
  const next = new Map<number, number>();
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const a = value(i, j) > LEVEL; // bottom left
      const b = value(i + 1, j) > LEVEL; // bottom right
      const c = value(i + 1, j + 1) > LEVEL; // top right
      const d = value(i, j + 1) > LEVEL; // top left
      if (a === b && b === c && c === d) continue;
      // the cell's edges counter-clockwise, each from its first corner to its second
      const edges: [number, boolean, boolean][] = [
        [hEdge(i, j), a, b],
        [vEdge(i + 1, j), b, c],
        [hEdge(i, j + 1), c, d],
        [vEdge(i, j), d, a],
      ];
      // a segment runs from where the boundary leaves the inside to where it comes back:
      // an isolated inside corner lies between an entering edge and the leaving one after it
      // (counter-clockwise); in a saddle whose centre is inside, the two inside corners join
      // and each leaving edge goes on to the entering edge after it
      const saddle = edges.filter(([, from, to]) => from !== to).length === 4;
      const centre = (value(i, j) + value(i + 1, j) + value(i + 1, j + 1) + value(i, j + 1)) / 4 > LEVEL;
      const step = saddle && centre ? 1 : 3;
      edges.forEach(([edge, from, to], k) => {
        if (!from || to) return;
        if (!saddle) {
          const entering = edges.find(([, f, t]) => !f && t);
          if (entering) next.set(edge, entering[0]);
          return;
        }
        next.set(edge, edges[(k + step) % 4][0]);
      });
    }
  }

  const rings: Ring[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring: Ring = [];
    let edge: number | undefined = start;
    while (edge !== undefined && !seen.has(edge)) {
      seen.add(edge);
      ring.push(crossing(edge));
      edge = next.get(edge);
    }
    if (ring.length >= 3) rings.push(simplifyRing(ring, tolerance));
  }
  return rings;
}

/** Ramer–Douglas–Peucker on a closed ring: split at the farthest pair, simplify both halves. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 3) return ring;
  const first = ring[0];
  let far = 0;
  let best = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot(ring[k][0] - first[0], ring[k][1] - first[1]);
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length],
  ];
  while (stack.length > 0) {
    const [s, e] = stack.pop() ?? [0, 0];
    const a = ring[s];
    const b = ring[e % ring.length];
    let worst = 0;
    let at = -1;
    for (let k = s + 1; k < e; k++) {
      const d = distanceToLine(ring[k], a, b);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  const out = ring.filter((_, k) => keep[k] === 1);
  // a ring simplified below a triangle keeps its original shape
  return out.length >= 3 ? out : ring;
}

function distanceToLine(p: Readonly<Point>, a: Readonly<Point>, b: Readonly<Point>): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
