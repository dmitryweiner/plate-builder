// A text block → its raster (spec §4, §8.3): drawn by the browser with the
// bundled font at 10 px/mm, the capital height measured from the font, lines
// laid out by the app, Hebrew shaped right to left. The geometry of the
// block is pure and tested; the drawing needs a canvas (checked by the smoke).

import type { Align, TextElement } from '../geo/state';
import { lineOffsets } from '../geo/textLayout';
import type { TextRaster } from '../geo/textShape';

export const PX_PER_MM = 10;
/** A raster side's limit (spec §13); a bigger text is drawn coarser. */
export const MAX_RASTER_PX = 4096;

/** px/mm for a block of this many mm: 10, or less so that no side passes the limit. */
export function rasterScale(widthMm: number, heightMm: number): number {
  return Math.min(PX_PER_MM, MAX_RASTER_PX / Math.max(widthMm, heightMm, 1e-6));
}

export function hasRtl(line: string): boolean {
  return /[֐-׿יִ-ﭏ]/.test(line);
}

export interface BlockMetrics {
  /** capital height, px */
  cap: number;
  /** baseline to baseline, px */
  advance: number;
  /** the tallest ink above / the deepest below a baseline, px */
  ascent: number;
  descent: number;
  /** room around the ink, px */
  pad: number;
  align: Align;
  arc: boolean;
}

export interface BlockGeometry {
  width: number;
  height: number;
  /** each line's left end and baseline, px in the raster */
  lefts: number[];
  baselines: number[];
  originX: number;
  originY: number;
}

/** Where the lines go in the raster and where the element's origin is (TextRaster). */
export function blockGeometry(widths: readonly number[], m: BlockMetrics): BlockGeometry {
  const widest = Math.max(0, ...widths);
  const n = Math.max(1, widths.length);
  const firstBaseline = m.pad + m.ascent;
  const baselines = Array.from({ length: n }, (_, k) => firstBaseline + k * m.advance);
  const lastBaseline = baselines[n - 1];
  const originX = m.pad + widest / 2;
  return {
    width: Math.ceil(widest + 2 * m.pad),
    height: Math.ceil(lastBaseline + m.descent + m.pad),
    lefts: lineOffsets(widths, m.align).map((x) => originX + x),
    baselines,
    originX,
    originY: m.arc ? firstBaseline : (firstBaseline - m.cap + lastBaseline) / 2,
  };
}

/** The lines a block draws: one for an arc (extra lines joined, `text.arcLines` says so). */
export function blockLines(text: Pick<TextElement, 'text' | 'arc'>): string[] {
  const lines = text.text.split('\n');
  return text.arc ? [lines.join(' ')] : lines;
}

export interface FontSpec {
  family: string;
  weight: string;
}

/** Draws a block; null without a canvas or with nothing to draw. */
export function rasterizeText(text: TextElement, font: FontSpec): TextRaster | null {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const lines = blockLines(text);
  if (lines.every((line) => line.trim() === '')) return null;
  const css = (px: number) => `${font.weight} ${px}px ${font.family}`;

  // the capital height of this font, as a share of its size
  const reference = 100;
  ctx.font = css(reference);
  const capRatio = ctx.measureText('H').actualBoundingBoxAscent / reference || 0.7;

  const measure = (pxPerMm: number) => {
    const fontPx = (text.size * pxPerMm) / capRatio;
    ctx.font = css(fontPx);
    const metrics = lines.map((line) => {
      ctx.direction = hasRtl(line) ? 'rtl' : 'ltr';
      return ctx.measureText(line);
    });
    const geometry = blockGeometry(
      metrics.map((m) => m.width),
      {
        cap: text.size * pxPerMm,
        advance: text.size * text.lineSpacing * pxPerMm,
        ascent: Math.max(text.size * pxPerMm, ...metrics.map((m) => m.actualBoundingBoxAscent)),
        descent: Math.max(0, ...metrics.map((m) => m.actualBoundingBoxDescent)),
        // scripts overhang their advance; a third of the size is room enough
        pad: Math.ceil(fontPx / 3),
        align: text.align,
        arc: text.arc,
      },
    );
    return { fontPx, geometry };
  };

  let pxPerMm = PX_PER_MM;
  let { fontPx, geometry } = measure(pxPerMm);
  if (geometry.width > MAX_RASTER_PX || geometry.height > MAX_RASTER_PX) {
    pxPerMm = rasterScale(geometry.width / pxPerMm, geometry.height / pxPerMm);
    ({ fontPx, geometry } = measure(pxPerMm));
  }

  ctx.canvas.width = Math.min(MAX_RASTER_PX, geometry.width);
  ctx.canvas.height = Math.min(MAX_RASTER_PX, geometry.height);
  ctx.font = css(fontPx);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, k) => {
    ctx.direction = hasRtl(line) ? 'rtl' : 'ltr';
    ctx.fillText(line, geometry.lefts[k], geometry.baselines[k]);
  });
  const { width, height } = ctx.canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
  return { width, height, data, pxPerMm, originX: geometry.originX, originY: geometry.originY, cap: text.size };
}
