// Binary STL (little-endian): an 80-byte header, a uint32 triangle count,
// per triangle a normal (3×f32), three vertices (9×f32) and a uint16
// attribute. The file carries no units; slicers take them as millimetres,
// which is what the core works in.

import type { SurfaceMesh } from './mesh';

export interface StlOptions {
  /** goes into the 80-byte header after the app name */
  name?: string;
}

export function encodeSTL(mesh: Pick<SurfaceMesh, 'positions' | 'indices'>, o: StlOptions = {}): ArrayBuffer {
  const { positions, indices } = mesh;
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  const header = `Plate Builder ${o.name ?? ''}`.trim().slice(0, 80);
  new TextEncoder().encodeInto(header, new Uint8Array(buf, 0, 80));
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-30) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    dv.setFloat32(off, nx, true);
    dv.setFloat32(off + 4, ny, true);
    dv.setFloat32(off + 8, nz, true);
    off += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(off, positions[v], true);
      dv.setFloat32(off + 4, positions[v + 1], true);
      dv.setFloat32(off + 8, positions[v + 2], true);
      off += 12;
    }
    dv.setUint16(off, 0, true);
    off += 2;
  }
  return buf;
}

/** `door-sign` from "Door sign": lower case, letters and digits of any script, dashes between words. */
export function fileSlug(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'plate';
}

export const stlFileName = (projectName: string): string => `${fileSlug(projectName)}.stl`;
