import { describe, expect, it } from 'vitest';
import { meshNormals } from './mesh';
import { meshProblems, validateMesh } from './validate';

function mesh(positions: number[], indices: number[]) {
  const p = new Float32Array(positions);
  const i = new Uint32Array(indices);
  return { positions: p, indices: i, normals: meshNormals(p, i) };
}

const TETRA_P = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const TETRA_I = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];

describe('validateMesh', () => {
  it('passes a closed outward solid', () => {
    const report = validateMesh(mesh(TETRA_P, TETRA_I));
    expect(report.watertight).toBe(true);
    expect(report.volume).toBeCloseTo(1 / 6);
    expect(report.triangleCount).toBe(4);
    expect(report.bbox).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(meshProblems(report)).toEqual([]);
  });

  it('finds an open mesh', () => {
    const report = validateMesh(mesh(TETRA_P, TETRA_I.slice(0, 9)));
    expect(report.watertight).toBe(false);
    expect(meshProblems(report)).toContain('open');
  });

  it('finds an inside-out mesh', () => {
    const flipped = TETRA_I.map((_, k) => TETRA_I[k - (k % 3) + 2 - (k % 3)] ?? 0);
    const report = validateMesh(mesh(TETRA_P, flipped));
    expect(report.watertight).toBe(true);
    expect(report.volume).toBeLessThan(0);
    expect(meshProblems(report)).toEqual(['inverted']);
  });

  it('counts degenerate triangles and blocks when they are more than 1 %', () => {
    const p = [...TETRA_P, 2, 0, 0];
    const report = validateMesh(mesh(p, [...TETRA_I, 0, 1, 4]));
    expect(report.degenerateTriangles).toBe(1);
    expect(meshProblems(report)).toContain('degenerate');
  });

  it('finds bad indices, empty and non-finite meshes', () => {
    expect(meshProblems(validateMesh(mesh(TETRA_P, [0, 1, 9])))).toContain('badIndices');
    expect(meshProblems(validateMesh(mesh([], [])))).toContain('empty');
    expect(meshProblems(validateMesh(mesh([Number.NaN, 0, 0, ...TETRA_P.slice(3)], TETRA_I)))).toContain('nonFinite');
  });
});
