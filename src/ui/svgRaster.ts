// Vignettes and own SVG outlines (spec §2.5, §2.6): an SVG is drawn by the
// browser into a canvas at 10 px/mm and its coverage traced in the worker —
// no SVG path parser in the app. Drawing goes through an <img>, so an
// uploaded file's scripts never run. The size rule and the catalog's schema
// are pure and tested; the drawing is checked by the smoke.

import { LIMITS } from '../geo/state';
import type { TextRaster } from '../geo/textShape';
import { MAX_RASTER_PX, rasterScale } from './textRaster';

/** Only these go into the catalog (spec §2.5). */
export const ALLOWED_LICENCES = ['CC0-1.0', 'public-domain'] as const;

export interface VignetteEntry {
  id: string;
  file: string;
  names: { en: string; ru: string; uk: string; he: string };
  source: string;
  author: string;
  licence: (typeof ALLOWED_LICENCES)[number];
  /** what was changed from the source (strokes filled, gaps closed), if anything */
  modified?: string;
}

/** The silhouette's size: stretched to width × height, or the SVG's own proportions fitted inside them. */
export function silhouetteSize(width: number, height: number, aspect: number, keep: boolean): [number, number] {
  if (!keep || !(aspect > 0) || !Number.isFinite(aspect)) return [width, height];
  return aspect >= width / height ? [width, width / aspect] : [height * aspect, height];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 300;

function parseEntry(value: unknown): VignetteEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const v: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const names: Record<string, unknown> = typeof v.names === 'object' && v.names !== null ? Object.fromEntries(Object.entries(v.names)) : {};
  const { id, file, source, author, licence, modified } = v;
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) return null;
  if (typeof file !== 'string' || !/^[a-z0-9-]+\.svg$/.test(file)) return null;
  if (!isText(source) || !isText(author)) return null;
  const allowed = ALLOWED_LICENCES.find((l) => l === licence);
  if (!allowed) return null;
  const { en, ru, uk, he } = names;
  if (!isText(en) || !isText(ru) || !isText(uk) || !isText(he)) return null;
  return { id, file, names: { en, ru, uk, he }, source, author, licence: allowed, ...(isText(modified) ? { modified } : {}) };
}

/** The catalog's index (`public/vignettes/index.json`): its complete entries. */
export function parseCatalog(json: unknown): VignetteEntry[] {
  if (typeof json !== 'object' || json === null || !('vignettes' in json) || !Array.isArray(json.vignettes)) return [];
  return json.vignettes.flatMap((entry: unknown) => {
    const parsed = parseEntry(entry);
    return parsed ? [parsed] : [];
  });
}

// ---------------------------------------------------------------------------
// Browser glue.

export async function loadSvgImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** An SVG's proportions as the browser sees them (1 when it does not say). */
export const svgAspect = (image: HTMLImageElement): number =>
  image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;

/** The silhouette at w × h mm: coverage from the drawing's alpha, the origin in its middle. */
export function rasterizeSilhouette(image: HTMLImageElement, widthMm: number, heightMm: number): TextRaster | null {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const pxPerMm = rasterScale(widthMm, heightMm);
  // a pixel of room around it, so a contour touching the edge still closes inside the raster
  const pad = 2;
  const w = Math.max(1, Math.round(widthMm * pxPerMm));
  const h = Math.max(1, Math.round(heightMm * pxPerMm));
  ctx.canvas.width = Math.min(MAX_RASTER_PX, w + 2 * pad);
  ctx.canvas.height = Math.min(MAX_RASTER_PX, h + 2 * pad);
  ctx.drawImage(image, pad, pad, w, h);
  const { width, height } = ctx.canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
  return { width, height, data, pxPerMm, originX: width / 2, originY: height / 2, cap: 0 };
}

/** An uploaded SVG file → a data URL, refused when too large or when the browser cannot draw it. */
export async function readSvgFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = `data:image/svg+xml;base64,${btoa(binary)}`;
  if (url.length > LIMITS.svgUrlChars) throw new Error('file too large');
  await loadSvgImage(url);
  return url;
}

/**
 * The browser side of silhouettes for the app: SVGs loaded once by URL (a
 * catalog path relative to the app, or an uploaded file's data URL), drawn
 * at a size on demand and kept.
 */
export function browserSilhouettes(base: string) {
  const images = new Map<string, HTMLImageElement>();
  const rasters = new Map<string, TextRaster | null>();
  const resolveUrl = (url: string) => (url.startsWith('data:') ? url : `${base}${url}`);
  return {
    async catalog(): Promise<VignetteEntry[]> {
      const response = await fetch(`${base}vignettes/index.json`);
      return parseCatalog(await response.json());
    },
    async load(url: string): Promise<number> {
      const image = images.get(url) ?? (await loadSvgImage(resolveUrl(url)));
      images.set(url, image);
      return svgAspect(image);
    },
    raster(url: string, widthMm: number, heightMm: number): TextRaster | null {
      const image = images.get(url);
      if (!image) return null;
      const key = `${url.length}:${url.slice(-64)}|${widthMm}|${heightMm}`;
      if (!rasters.has(key)) {
        if (rasters.size > 8) rasters.delete(rasters.keys().next().value ?? '');
        rasters.set(key, rasterizeSilhouette(image, widthMm, heightMm));
      }
      return rasters.get(key) ?? null;
    },
    readFile: readSvgFile,
  };
}
