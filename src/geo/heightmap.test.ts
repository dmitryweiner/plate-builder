import { describe, expect, it } from 'vitest';
import { boxBlur, heightField, processPixels, sampleField, type Raster } from './heightmap';

/** A raster from rows of [gray, alpha] pairs. */
function raster(rows: [number, number][][]): Raster {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8Array(width * height * 2);
  rows.flat().forEach(([g, a], i) => {
    data[i * 2] = g;
    data[i * 2 + 1] = a;
  });
  return { width, height, data };
}

const opaque = (values: number[][]) => raster(values.map((row) => row.map((v): [number, number] => [v, 255])));
const plain = { invert: false, black: 0, white: 255, blur: 0 };

describe('processPixels', () => {
  it('maps brightness to 0…1, white high', () => {
    const f = processPixels(opaque([[0, 51, 255]]), plain);
    expect([f[0], f[2]]).toEqual([0, 1]);
    expect(f[1]).toBeCloseTo(0.2);
  });

  it('inverts: black high', () => {
    expect([...processPixels(opaque([[0, 255]]), { ...plain, invert: true })]).toEqual([1, 0]);
  });

  it('stretches levels between the black and white points, clamped', () => {
    const f = processPixels(opaque([[10, 50, 100, 150, 200]]), { ...plain, black: 50, white: 150 });
    expect([...f]).toEqual([0, 0, 0.5, 1, 1]);
  });

  it('multiplies by alpha: transparent is height 0', () => {
    const f = processPixels(
      raster([
        [
          [255, 0],
          [255, 51],
          [200, 255],
        ],
      ]),
      plain,
    );
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(0.2);
    expect(f[2]).toBeCloseTo(200 / 255);
  });

  it('inverting does not raise transparent pixels', () => {
    expect(processPixels(raster([[[0, 0]]]), { ...plain, invert: true })[0]).toBe(0);
  });
});

describe('boxBlur', () => {
  it('averages over (2r + 1)² pixels with edges clamped, keeping the total of a flat field', () => {
    const field = new Float32Array([0, 0, 0, 0, 9, 0, 0, 0, 0]);
    const blurred = boxBlur(field, 3, 3, 1);
    expect(blurred[4]).toBeCloseTo(1);
    // a corner sees the spike once among its clamped neighbours
    expect(blurred[0]).toBeCloseTo(1);
    expect([...boxBlur(new Float32Array(9).fill(0.5), 3, 3, 2)].every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it('does nothing with radius 0', () => {
    const field = new Float32Array([1, 0, 1]);
    expect(boxBlur(field, 3, 1, 0)).toBe(field);
  });
});

describe('sampleField', () => {
  // a 2 × 1 picture 20 × 10 mm: pixel centres at x = −5 and +5
  const field = new Float32Array([0, 1]);
  const at = (x: number, y: number) => sampleField(field, 2, 1, 20, 10, x, y);

  it('is bilinear between pixel centres', () => {
    expect(at(-5, 0)).toBeCloseTo(0);
    expect(at(0, 0)).toBeCloseTo(0.5);
    expect(at(2.5, 3)).toBeCloseTo(0.75);
  });

  it('holds the edge pixel out to the picture border and is 0 outside it', () => {
    expect(at(9.9, 4.9)).toBeCloseTo(1);
    expect(at(10.1, 0)).toBe(0);
    expect(at(0, -5.1)).toBe(0);
  });

  it('puts row 0 at the top (y up)', () => {
    const tall = new Float32Array([1, 0]);
    expect(sampleField(tall, 1, 2, 10, 20, 0, 5)).toBeCloseTo(1);
    expect(sampleField(tall, 1, 2, 10, 20, 0, -5)).toBeCloseTo(0);
  });
});

describe('heightField', () => {
  it('scales the processed field by the relief height', () => {
    const h = heightField(opaque([[0, 255]]), { ...plain, height: 2 });
    expect([...h.values]).toEqual([0, 2]);
    expect([h.width, h.height]).toEqual([2, 1]);
  });
});
