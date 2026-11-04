import { describe, expect, it } from 'vitest';
import { encodeSTL, stlFileName } from './stl';

/** A unit tetrahedron, outward-facing. */
const tetra = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};

/** Reads a binary STL back: header text, triangles with their normals and vertices. */
function decode(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 80)).replace(/\0+$/, '');
  const count = view.getUint32(80, true);
  const triangles = Array.from({ length: count }, (_, t) => {
    const at = 84 + t * 50;
    const floats = Array.from({ length: 12 }, (__, k) => view.getFloat32(at + k * 4, true));
    return {
      normal: floats.slice(0, 3),
      vertices: [floats.slice(3, 6), floats.slice(6, 9), floats.slice(9, 12)],
      attribute: view.getUint16(at + 48, true),
    };
  });
  return { header, count, triangles };
}

describe('encodeSTL', () => {
  it('writes the header, the count and every triangle with its outward unit normal', () => {
    const buffer = encodeSTL(tetra, { name: 'door-sign' });
    expect(buffer.byteLength).toBe(84 + 4 * 50);
    const { header, count, triangles } = decode(buffer);
    expect(header).toBe('Plate Builder door-sign');
    expect(count).toBe(4);
    expect(triangles[0]?.vertices).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    expect(triangles[0]?.normal).toEqual([0, 0, -1]);
    const slanted = triangles[3]?.normal ?? [];
    expect(Math.hypot(...slanted)).toBeCloseTo(1, 6);
    for (const c of slanted) expect(c).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(triangles.every((t) => t.attribute === 0)).toBe(true);
  });

  it('cuts a long name to the 80-byte header', () => {
    const { header } = decode(encodeSTL(tetra, { name: 'x'.repeat(200) }));
    expect(header).toHaveLength(80);
  });

  it('writes an empty mesh as a valid empty file', () => {
    const buffer = encodeSTL({ positions: new Float32Array(), indices: new Uint32Array() });
    expect(decode(buffer).count).toBe(0);
  });
});

describe('stlFileName', () => {
  it('makes a file name from the project name', () => {
    expect(stlFileName('Door sign')).toBe('door-sign.stl');
    expect(stlFileName('  Кот Барсик! ')).toBe('кот-барсик.stl');
    expect(stlFileName('שלט')).toBe('שלט.stl');
    expect(stlFileName('../../etc')).toBe('etc.stl');
    expect(stlFileName('***')).toBe('plate.stl');
  });
});
