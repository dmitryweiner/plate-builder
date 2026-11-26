// A text block → its raster (spec §4, §8.3): drawn by the kit's text raster
// (`maker-kit/ui/textRaster`: the bundled font at 10 px/mm, the capital
// height measured from the font, Hebrew shaped right to left). Here: what a
// text element asks of it — its lines (an arc joins them), size, spacing,
// alignment and origin.

import type { FontSpec } from 'maker-kit/ui/fonts';
import type { TextRaster } from 'maker-kit/core/raster';
import { rasterizeText as drawText } from 'maker-kit/ui/textRaster';
import type { TextElement } from '../geo/state';

/** The lines a block draws: one for an arc (extra lines joined, `text.arcLines` says so). */
export function blockLines(text: Pick<TextElement, 'text' | 'arc'>): string[] {
  const lines = text.text.split('\n');
  return text.arc ? [lines.join(' ')] : lines;
}

/**
 * Draws a block; null without a canvas or with nothing to draw. A straight
 * block's origin is its middle; a text on an arc has its origin on the
 * strip's baseline, where the arc bends it.
 */
export function rasterizeText(text: TextElement, font: FontSpec): TextRaster | null {
  return drawText({
    lines: blockLines(text),
    capMm: text.size,
    lineSpacing: text.lineSpacing,
    align: text.align,
    origin: text.arc ? 'baseline' : 'middle',
    font,
  });
}
