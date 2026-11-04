// A text block's shape from its raster (spec §4, §8.3): the contours traced
// at 50 %, in the element's own frame (mm, y up, around its position), bent
// onto the arc when the text is on one. The 2D view and the worker both use
// it, so what is drawn is what is built.

import { traceContours } from './contour';
import type { Ring } from './outline';
import type { TextElement } from './state';
import { bendRings } from './textLayout';

/** A text block drawn by the main thread: coverage 0–255, row 0 at the top. */
export interface TextRaster {
  width: number;
  height: number;
  data: Uint8Array;
  pxPerMm: number;
  /**
   * The element's origin in the raster, px from the left and from the top:
   * the block's middle for straight text, the strip's middle on its baseline
   * for text on an arc.
   */
  originX: number;
  originY: number;
  /** the capital letter height as drawn, mm */
  cap: number;
}

export function isTextRaster(value: unknown): value is TextRaster {
  if (typeof value !== 'object' || value === null) return false;
  const v: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const n = (key: string) => typeof v[key] === 'number' && Number.isFinite(v[key]);
  if (!['width', 'height', 'pxPerMm', 'originX', 'originY', 'cap'].every(n)) return false;
  const { width, height, data, pxPerMm } = v;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= 4096 &&
    height <= 4096 &&
    typeof pxPerMm === 'number' &&
    pxPerMm > 0 &&
    data instanceof Uint8Array &&
    data.length === width * height
  );
}

export function textRings(
  raster: TextRaster,
  text: Pick<TextElement, 'arc' | 'arcRadius' | 'arcSide'>,
): { rings: Ring[]; squeeze: number } {
  const { pxPerMm, originX, height } = raster;
  // contours come in pixels with y up from the raster's bottom
  const originUp = height - raster.originY;
  const rings = traceContours(raster).map((ring) =>
    ring.map(([x, y]): [number, number] => [(x - originX) / pxPerMm, (y - originUp) / pxPerMm]),
  );
  if (!text.arc) return { rings, squeeze: 1 };
  return bendRings(rings, text.arcRadius, text.arcSide, raster.cap);
}
