// A text block's shape from its raster (spec §4, §8.3; the raster is the
// kit's `TextRaster`): the contours traced at 50 % (the kit's
// `traceContours`), in the element's own frame (mm, y up, around its
// position), bent onto the arc when the text is on one. The 2D view and the
// worker both use it, so what is drawn is what is built.

import type { TextRaster } from 'maker-kit/core/raster';
import { traceContours } from 'maker-kit/core/raster';
import type { Ring } from './outline';
import type { TextElement } from './state';
import { bendRings } from './textLayout';

/** A mask's contours in mm around its origin (y up): a silhouette's, or a straight text's. */
export function maskRings(raster: TextRaster): Ring[] {
  const up = raster.height - raster.originY;
  return traceContours(raster).map((ring) =>
    ring.map(([x, y]): [number, number] => [(x - raster.originX) / raster.pxPerMm, (y - up) / raster.pxPerMm]),
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
