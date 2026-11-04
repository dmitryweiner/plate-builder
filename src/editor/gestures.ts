// The maths of the 2D editor's gestures, in the plate frame (mm). The
// pointer handling converts screen positions with the view transform and
// calls these; they know nothing of events or pixels, except where a
// threshold is given in mm by the caller.

import type { Point } from '../geo/outline';
import type { PlateElement } from '../geo/state';
import { boxCorners, scaleElement } from './elements';

export function moveElement<E extends PlateElement>(start: E, dx: number, dy: number): E {
  return { ...start, x: start.x + dx, y: start.y + dy };
}

/**
 * A corner handle dragged to `pointer`: a uniform scale that keeps the
 * opposite corner where it was. The factor is the pointer's reach along the
 * diagonal from that corner.
 */
export function scaleFromCorner<E extends PlateElement>(start: E, corner: number, pointer: Readonly<Point>): E {
  const corners = boxCorners(start);
  const opposite = corners[(corner + 2) % 4];
  const dragged = corners[corner % 4];
  const dx = dragged[0] - opposite[0];
  const dy = dragged[1] - opposite[1];
  const diagonal2 = dx * dx + dy * dy;
  if (diagonal2 < 1e-12) return start;
  const reach = ((pointer[0] - opposite[0]) * dx + (pointer[1] - opposite[1]) * dy) / diagonal2;
  const { element, factor } = scaleElement(start, Math.max(reach, 1e-3));
  return { ...element, x: opposite[0] + (start.x - opposite[0]) * factor, y: opposite[1] + (start.y - opposite[1]) * factor };
}

/** Degrees in 0…360. */
export function normalizeAngle(degrees: number): number {
  const a = ((degrees % 360) + 360) % 360;
  return a >= 360 ? 0 : a + 0;
}

/**
 * The rotation handle dragged to `pointer`. The handle sits above the box
 * (the element's +y), so the element's angle is the pointer's bearing from
 * the centre less 90°; with `step` it snaps to multiples of it.
 */
export function rotateTowards<E extends PlateElement>(start: E, pointer: Readonly<Point>, step: number | null = null): E {
  const bearing = (Math.atan2(pointer[1] - start.y, pointer[0] - start.x) * 180) / Math.PI;
  const angle = bearing - 90;
  return { ...start, rotation: normalizeAngle(step ? Math.round(angle / step) * step : angle) };
}

/**
 * Two fingers moved from (a0, b0) to (a1, b1): the element scales by the
 * change of their distance, turns by the change of their bearing and moves
 * with their midpoint.
 */
export function pinchElement<E extends PlateElement>(
  start: E,
  a0: Readonly<Point>,
  b0: Readonly<Point>,
  a1: Readonly<Point>,
  b1: Readonly<Point>,
): E {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const turn = (Math.atan2(b1[1] - a1[1], b1[0] - a1[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0])) * (180 / Math.PI);
  const { element } = scaleElement(start, d0 > 1e-9 ? d1 / d0 : 1);
  return {
    ...element,
    x: start.x + (a1[0] + b1[0] - a0[0] - b0[0]) / 2,
    y: start.y + (a1[1] + b1[1] - a0[1] - b0[1]) / 2,
    rotation: normalizeAngle(start.rotation + turn),
  };
}

export interface SnapTargets {
  /** vertical lines to snap a centre's x to */
  xs: readonly number[];
  /** horizontal lines to snap a centre's y to */
  ys: readonly number[];
}

export interface Snapped {
  point: Point;
  /** the lines snapped to, for the guides; null when free */
  guides: { x: number | null; y: number | null };
}

/** Snaps a centre to the nearest line within `threshold` mm, each axis on its own. */
export function snapPoint(point: Readonly<Point>, targets: SnapTargets, threshold: number): Snapped {
  const nearest = (value: number, lines: readonly number[]): number | null => {
    let best: number | null = null;
    for (const line of lines)
      if (Math.abs(line - value) <= threshold && (best === null || Math.abs(line - value) < Math.abs(best - value))) best = line;
    return best;
  };
  const gx = nearest(point[0], targets.xs);
  const gy = nearest(point[1], targets.ys);
  return { point: [gx ?? point[0], gy ?? point[1]], guides: { x: gx, y: gy } };
}

/** What a dragged element snaps to: the plate's axes and the other visible elements' centres. */
export function snapTargets(elements: readonly PlateElement[], movingId: string): SnapTargets {
  const others = elements.filter((e) => e.visible && e.id !== movingId);
  return { xs: [0, ...others.map((e) => e.x)], ys: [0, ...others.map((e) => e.y)] };
}
