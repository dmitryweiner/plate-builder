// Pure mesh checks. The validator reports; meshProblems decides what blocks
// an export (spec §6: watertight, no degenerate triangles, positive volume).

import type { SurfaceMesh } from './mesh';

export interface MeshReport {
  /** every position and normal is finite */
  finite: boolean;
  /** indices are complete triangles and point at existing vertices */
  indicesValid: boolean;
  /** every edge is in exactly 2 triangles with opposite orientation */
  watertight: boolean;
  /** signed volume, mm³; > 0 means the normals point out */
  volume: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** triangles with an area below eps */
  degenerateTriangles: number;
  triangleCount: number;
  vertexCount: number;
}

export type MeshProblem = 'nonFinite' | 'badIndices' | 'empty' | 'open' | 'inverted' | 'degenerate';

/**
 * What blocks the export. A boolean leaves a few slivers where surfaces meet
 * tangentially; they do not hurt printing, so up to 1 % of the triangles
 * pass.
 */
export function meshProblems(report: MeshReport): MeshProblem[] {
  const problems: MeshProblem[] = [];
  if (!report.finite) problems.push('nonFinite');
  if (!report.indicesValid) problems.push('badIndices');
  if (report.triangleCount === 0) problems.push('empty');
  else {
    if (!report.watertight) problems.push('open');
    if (report.volume <= 0) problems.push('inverted');
    if (report.degenerateTriangles / report.triangleCount > 0.01) problems.push('degenerate');
  }
  return problems;
}

/** Signed volume of a closed mesh (a sum of tetrahedra from the origin); positive with outward normals. */
export function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let volume6 = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    volume6 +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return volume6 / 6;
}

export function validateMesh(mesh: SurfaceMesh, areaEps = 1e-12): MeshReport {
  const { positions, indices } = mesh;

  let finite = true;
  for (const values of [positions, mesh.normals]) {
    for (let i = 0; i < values.length && finite; i++) if (!Number.isFinite(values[i])) finite = false;
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const x = positions[i + c];
      if (x < min[c]) min[c] = x;
      if (x > max[c]) max[c] = x;
    }
  }

  // Edges keyed by the unordered pair; balance counts the orientation
  // (a→b: +1, b→a: −1). Watertight ⇔ every edge seen twice with balance 0.
  const edges = new Map<number, { count: number; balance: number }>();
  const nVerts = positions.length / 3;
  let indicesValid = indices.length % 3 === 0;
  for (let i = 0; i < indices.length && indicesValid; i++) if (indices[i] >= nVerts) indicesValid = false;
  const edgeKey = (a: number, b: number): number => (a < b ? a * nVerts + b : b * nVerts + a);
  let degenerate = 0;
  for (let t = 0; t < (indicesValid ? indices.length : 0); t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    for (const [a, b] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ]) {
      const key = edgeKey(a, b);
      let e = edges.get(key);
      if (!e) {
        e = { count: 0, balance: 0 };
        edges.set(key, e);
      }
      e.count++;
      e.balance += a < b ? 1 : -1;
    }
    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const area2 = Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
    if (area2 * 0.5 < areaEps) degenerate++;
  }
  let watertight = indicesValid && indices.length > 0;
  for (const e of edges.values()) {
    if (e.count !== 2 || e.balance !== 0) {
      watertight = false;
      break;
    }
  }

  return {
    finite,
    indicesValid,
    watertight,
    volume: indicesValid ? signedVolume(positions, indices) : 0,
    bbox: { min, max },
    degenerateTriangles: degenerate,
    triangleCount: indices.length / 3,
    vertexCount: nVerts,
  };
}
