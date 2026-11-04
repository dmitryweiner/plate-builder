// Elements' boxes in their own frames and on the plate: what the 2D view
// selects and draws handles on, what warnings compare. Pure.
//
// A text's real box comes from its raster, which the main thread draws;
// until then (and in the worker, which does not need it) it is estimated
// from the size. The app records measured boxes in `measuredTextBoxes`.

import { holeBox, placePoint } from './holes';
import type { Bounds, Point } from './outline';
import type { PlateElement } from './state';

/** Text boxes measured from their rasters, by element id; the app keeps it current. */
export const measuredTextBoxes = new Map<string, Bounds>();

/** The element's box in its own frame (before rotation, around its position). */
export function elementBox(e: PlateElement): Bounds {
  if (e.type === 'hole') return holeBox(e);
  if (e.type === 'image') {
    const long = Math.max(e.pixelWidth, e.pixelHeight);
    const w = (e.size * e.pixelWidth) / long;
    const h = (e.size * e.pixelHeight) / long;
    return { minX: -w / 2, maxX: w / 2, minY: -h / 2, maxY: h / 2 };
  }
  const measured = measuredTextBoxes.get(e.id);
  if (measured) return measured;
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
