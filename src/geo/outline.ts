// Primitive outlines (spec §2.2) as polygons: counter-clockwise, centred on
// the origin, their box exactly width × height. Curves are sampled finely
// enough that a chord never strays more than CHORD_TOLERANCE from the curve.
//
// Corner rounding is not here: it needs offsetting, which the worker does
// with manifold (worker/build.ts). These rings are what the 2D view draws at
// once, before the worker answers.

import type { Plate, PrimitiveKind } from './state';

export type Point = [number, number];
/** A closed polygon; the last point joins the first. */
export type Ring = Point[];

/** How far a chord may stray from the curve, mm: well under a nozzle's line. */
export const CHORD_TOLERANCE = 0.01;

/** Segments of a full circle of this radius, a multiple of four so the box touches the curve. */
export function segmentsFor(radius: number, tolerance = CHORD_TOLERANCE): number {
  const n = radius <= tolerance ? 8 : Math.PI / Math.acos(1 - tolerance / radius);
  return Math.min(1024, Math.max(8, 4 * Math.ceil(n / 4)));
}

/** Signed area (shoelace): positive for counter-clockwise. */
export function ringArea(ring: Ring): number {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return twice / 2;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(rings: readonly Ring[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

/** Scales and moves a ring so that its box becomes exactly width × height around the origin. */
function fit(ring: Ring, width: number, height: number): Ring {
  const b = bounds([ring]);
  const sx = width / (b.maxX - b.minX);
  const sy = height / (b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return ring.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}

/** Drops points that repeat their neighbour (curves sampled through a cusp do that). */
function dedupe(ring: Ring): Ring {
  const out = ring.filter((p, i) => {
    const q = ring[(i + ring.length - 1) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
  return out.length >= 3 ? out : ring;
}

/** n points on a circle starting at the top, counter-clockwise. */
function around(n: number, radius: number, phase = Math.PI / 2): Ring {
  return Array.from({ length: n }, (_, k): Point => {
    const a = phase + (2 * Math.PI * k) / n;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
}

/** The classic heart x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t; the notch on top, the point below. */
function heart(n: number): Ring {
  // t runs backwards so the ring is counter-clockwise
  return Array.from({ length: n }, (_, i): Point => {
    const t = (-2 * Math.PI * i) / n;
    return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
  });
}

/** A heater shield: straight sides over the top 40 %, then curving into a point at the bottom. */
function shield(w: number, h: number, n: number): Ring {
  const y0 = h / 2 - 0.4 * h;
  const fall = y0 + h / 2;
  const right: Ring = [];
  // u from 0 (where the side ends) to 1 (the point): x = w/2·cos(uπ/2) keeps the side's tangent at the start
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    right.push([(w / 2) * Math.cos((u * Math.PI) / 2), y0 - u * fall]);
  }
  const point = right.at(-1) ?? [0, -h / 2];
  const left = right.slice(0, -1).map(([x, y]): Point => [-x, y]);
  // counter-clockwise: top right → top left → down the left side → the point → up the right side
  return [[w / 2, h / 2], [-w / 2, h / 2], ...left, [0, point[1]], ...right.slice(0, -1).toReversed()];
}

export function primitiveOutline(
  plate: Pick<Plate, 'width' | 'height' | 'sides' | 'points' | 'innerRatio'> & { kind: PrimitiveKind },
): Ring {
  const { width: w, height: h } = plate;
  const segments = segmentsFor(Math.max(w, h) / 2);
  const shapes: Record<PrimitiveKind, () => Ring> = {
    rectangle: () => [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ],
    ellipse: () => around(segments, 1, 0).map(([x, y]) => [(x * w) / 2, (y * h) / 2]),
    triangle: () => [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [0, h / 2],
    ],
    polygon: () => fit(around(plate.sides, 1), w, h),
    star: () => {
      const n = plate.points;
      const inner = around(n, plate.innerRatio, Math.PI / 2 + Math.PI / n);
      return fit(
        around(n, 1).flatMap((p, k) => [p, inner[k]]),
        w,
        h,
      );
    },
    heart: () => dedupe(fit(heart(2 * segments), w, h)),
    shield: () => dedupe(shield(w, h, Math.max(8, segments / 4))),
    tag: () => {
      const point = Math.min(h / 2, w / 2);
      return [
        [-w / 2, 0],
        [-w / 2 + point, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2 + point, h / 2],
      ];
    },
  };
  return shapes[plate.kind]();
}
