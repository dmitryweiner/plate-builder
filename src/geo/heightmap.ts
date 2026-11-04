// An image's height function (spec §3): h = height · L(v) · a, where v is
// the pixel's brightness (inverted when asked), L the levels mapping clamped
// to 0…1 and a the alpha; smoothed by a box blur, sampled bilinearly between
// pixel centres, 0 outside the picture.

/** A stored picture: gray and alpha interleaved, row 0 at the top. */
export interface Raster {
  width: number;
  height: number;
  /** width · height · 2 bytes: gray, alpha */
  data: Uint8Array;
}

export interface Levels {
  invert: boolean;
  /** 0–255 */
  black: number;
  white: number;
  /** box blur radius, px */
  blur: number;
}

/** Each pixel's share of the relief height, 0…1. */
export function processPixels(raster: Raster, levels: Levels): Float32Array {
  const { width, height, data } = raster;
  const out = new Float32Array(width * height);
  const span = Math.max(1, levels.white - levels.black);
  for (let i = 0; i < out.length; i++) {
    const gray = levels.invert ? 255 - data[i * 2] : data[i * 2];
    const level = Math.min(1, Math.max(0, (gray - levels.black) / span));
    out[i] = (level * data[i * 2 + 1]) / 255;
  }
  return boxBlur(out, width, height, Math.round(levels.blur));
}

/** A separable box blur of radius r (a (2r + 1)-wide window), edges clamped. */
export function boxBlur(field: Float32Array, width: number, height: number, r: number): Float32Array {
  if (r <= 0) return field;
  const pass = (src: Float32Array, horizontal: boolean): Float32Array => {
    const dst = new Float32Array(src.length);
    const [n, lines] = horizontal ? [width, height] : [height, width];
    const at = (line: number, k: number) => (horizontal ? line * width + k : k * width + line);
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < n; k++) {
        let sum = 0;
        for (let d = -r; d <= r; d++) sum += src[at(line, Math.min(n - 1, Math.max(0, k + d)))];
        dst[at(line, k)] = sum / (2 * r + 1);
      }
    }
    return dst;
  };
  return pass(pass(field, true), false);
}

/**
 * The field at a point of the image's own frame (mm, y up, the picture
 * w × h mm around the origin). Between pixel centres it is bilinear; in the
 * half pixel at the border it holds the edge; outside the picture it is 0.
 */
export function sampleField(field: Float32Array, pw: number, ph: number, w: number, h: number, x: number, y: number): number {
  if (x < -w / 2 || x > w / 2 || y < -h / 2 || y > h / 2) return 0;
  // pixel coordinates with centres at whole numbers
  const u = Math.min(pw - 1, Math.max(0, ((x + w / 2) / w) * pw - 0.5));
  const v = Math.min(ph - 1, Math.max(0, ((h / 2 - y) / h) * ph - 0.5));
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const i1 = Math.min(pw - 1, i0 + 1);
  const j1 = Math.min(ph - 1, j0 + 1);
  const fu = u - i0;
  const fv = v - j0;
  const top = field[j0 * pw + i0] * (1 - fu) + field[j0 * pw + i1] * fu;
  const bottom = field[j1 * pw + i0] * (1 - fu) + field[j1 * pw + i1] * fu;
  return top * (1 - fv) + bottom * fv;
}

export interface HeightField {
  width: number;
  height: number;
  /** mm above the base, per pixel */
  values: Float32Array;
}

export function heightField(raster: Raster, params: Levels & { height: number }): HeightField {
  const values = processPixels(raster, params);
  for (let i = 0; i < values.length; i++) values[i] *= params.height;
  return { width: raster.width, height: raster.height, values };
}

/** Checks a raster that came from outside (a worker message): the shape must add up. */
export function isRaster(value: unknown): value is Raster {
  if (typeof value !== 'object' || value === null) return false;
  if (!('width' in value) || !('height' in value) || !('data' in value)) return false;
  const { width, height, data } = value;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= 4096 &&
    height <= 4096 &&
    data instanceof Uint8Array &&
    data.length === width * height * 2
  );
}
