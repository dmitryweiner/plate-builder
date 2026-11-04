// The 2D view's transform between plate millimetres (y up) and screen CSS
// pixels (y down). The view never turns: pan and zoom only.

import type { Bounds, Point } from '../geo/outline';

export interface ViewTransform {
  /** CSS px per mm */
  scale: number;
  /** where the plate origin is on screen, CSS px */
  cx: number;
  cy: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 100;

export function toScreen(v: ViewTransform, [x, y]: Readonly<Point>): Point {
  return [v.cx + x * v.scale, v.cy - y * v.scale];
}

export function toPlate(v: ViewTransform, [sx, sy]: Readonly<Point>): Point {
  return [(sx - v.cx) / v.scale, (v.cy - sy) / v.scale];
}

/** The transform that shows `box` in the middle of the canvas, `margin` px from its edges. */
export function fitView(canvas: { width: number; height: number }, box: Bounds, margin: number): ViewTransform {
  const w = Math.max(1e-6, box.maxX - box.minX);
  const h = Math.max(1e-6, box.maxY - box.minY);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((canvas.width - 2 * margin) / w, (canvas.height - 2 * margin) / h)));
  return {
    scale,
    cx: canvas.width / 2 - ((box.minX + box.maxX) / 2) * scale,
    cy: canvas.height / 2 + ((box.minY + box.maxY) / 2) * scale,
  };
}

/** Zooms by `factor` about a screen point, which keeps showing the same plate point. */
export function zoomAt(v: ViewTransform, [sx, sy]: Readonly<Point>, factor: number): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, cx: sx - (sx - v.cx) * k, cy: sy - (sy - v.cy) * k };
}

export function panView(v: ViewTransform, dx: number, dy: number): ViewTransform {
  return { scale: v.scale, cx: v.cx + dx, cy: v.cy + dy };
}
