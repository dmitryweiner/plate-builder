// Text layout that needs no fonts (spec §4): the horizontal place of each
// line in a block, and the bending of a one-line strip onto an arc.
//
// Arc sides. Outside: the baseline lies on the circle, the letters stand
// outwards, along the top, read clockwise. Inside: the baseline lies on the
// circle, the letters stand towards the centre, along the bottom, upright
// and read left to right. Both measure the angle at the letters' middle
// (radius ± cap/2), so the text keeps its length there; letters come out
// slightly wedge-shaped, as on a coin.

import type { Point, Ring } from './outline';
import type { Align } from './state';

/** How much of a full circle an arc text may take before it is squeezed. */
export const ARC_FILL = 0.95;
/** Edges are cut into pieces at most this long before bending, mm, so straight edges follow the arc. */
const BEND_STEP = 0.25;

/** The left end of each line, relative to the block's centre, given the lines' widths. */
export function lineOffsets(widths: readonly number[], align: Align): number[] {
  const block = Math.max(0, ...widths);
  return widths.map((w) => (align === 'left' ? -block / 2 : align === 'right' ? block / 2 - w : -w / 2));
}

/** The radius whose arc length equals the strip's length. */
function middleRadius(radius: number, side: 'outside' | 'inside', cap: number): number {
  return side === 'outside' ? radius + cap / 2 : Math.max(1e-3, radius - cap / 2);
}

/** 1 when a strip `length` long fits ARC_FILL of the circle; less when it is squeezed to. */
export function arcFit(length: number, radius: number, side: 'outside' | 'inside', cap: number): number {
  const room = 2 * Math.PI * middleRadius(radius, side, cap) * ARC_FILL;
  return length > room ? room / length : 1;
}

/** A point of the strip (x along it from its middle, y up from the baseline) on the arc, relative to the circle's centre. */
export function bendPoint([x, y]: Readonly<Point>, radius: number, side: 'outside' | 'inside', cap: number): Point {
  const angle = x / middleRadius(radius, side, cap);
  if (side === 'outside') {
    const r = radius + y;
    return [r * Math.sin(angle), r * Math.cos(angle)];
  }
  const r = radius - y;
  return [r * Math.sin(angle), -r * Math.cos(angle)];
}

/** Cuts every edge into pieces no longer than `step`. */
function densify(ring: Ring, step: number): Ring {
  const out: Ring = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 0; s < n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
  }
  return out;
}

/**
 * Bends a strip's contours onto the arc. A strip longer than the circle
 * allows is squeezed along its length first; `squeeze` says by how much.
 */
export function bendRings(
  rings: readonly Ring[],
  radius: number,
  side: 'outside' | 'inside',
  cap: number,
): { rings: Ring[]; squeeze: number } {
  const b = rings.flat();
  const length = b.length ? Math.max(...b.map((p) => p[0])) - Math.min(...b.map((p) => p[0])) : 0;
  const squeeze = arcFit(length, radius, side, cap);
  // either side keeps orientation (the map's Jacobian is positive), so outer rings stay counter-clockwise
  const bent = rings.map((ring) => densify(ring, BEND_STEP).map(([x, y]) => bendPoint([x * squeeze, y], radius, side, cap)));
  return { rings: bent, squeeze };
}
