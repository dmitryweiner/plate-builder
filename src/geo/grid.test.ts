import { describe, expect, it } from 'vitest';
import { gridSize, heightfieldMesh } from './grid';
import { meshNormals } from './mesh';
import { validateMesh } from './validate';

const spec = { width: 10, height: 6, step: 1, zero: 2.99, bottom: 1.5, avoid: 3 };

function check(sample: (x: number, y: number) => number, over: Partial<typeof spec> = {}) {
  const mesh = heightfieldMesh(sample, { ...spec, ...over });
  const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
  return { mesh, report };
}

/** The volume by the same triangulation: each top triangle's prism down to the bottom. */
function expectedVolume(sample: (x: number, y: number) => number, s: typeof spec): number {
  const [nx, ny] = gridSize(s.width, s.height, s.step);
  const dx = s.width / nx;
  const dy = s.height / ny;
  const z = (i: number, j: number) => s.zero + sample(-s.width / 2 + i * dx, -s.height / 2 + j * dy) - s.bottom;
  let volume = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [a, b, c, d] = [z(i, j), z(i + 1, j), z(i + 1, j + 1), z(i, j + 1)];
      volume += ((dx * dy) / 2) * ((a + b + c) / 3 + (a + c + d) / 3);
    }
  }
  return volume;
}

/** A seeded generator, so a failing field can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('gridSize', () => {
  it('takes as many cells as the step fits, at least one, the edges exact', () => {
    expect(gridSize(10, 6, 1)).toEqual([10, 6]);
    expect(gridSize(10, 6, 0.3)).toEqual([34, 20]);
    expect(gridSize(0.2, 0.2, 1)).toEqual([1, 1]);
  });
});

describe('heightfieldMesh', () => {
  it('is a closed solid for random fields, with the volume of its cells', () => {
    const random = rng(7);
    for (let n = 0; n < 20; n++) {
      const values = new Map<string, number>();
      const sample = (x: number, y: number) => {
        const key = `${x.toFixed(6)},${y.toFixed(6)}`;
        if (!values.has(key)) values.set(key, random() < 0.3 ? 0 : random() * 3);
        return values.get(key) ?? 0;
      };
      const { report } = check(sample);
      expect(report.watertight).toBe(true);
      expect(report.degenerateTriangles).toBe(0);
      expect(report.volume).toBeCloseTo(expectedVolume(sample, spec), 4);
    }
  });

  it('is a closed box for an all-zero field and a flat one', () => {
    for (const level of [0, 1.25]) {
      const { report } = check(() => level);
      expect(report.watertight).toBe(true);
      expect(report.volume).toBeCloseTo(10 * 6 * (spec.zero + level - spec.bottom), 4);
      expect(report.bbox.min).toEqual([-5, -3, 1.5]);
    }
  });

  it('carries a single bright point as a spike', () => {
    const { report } = check((x, y) => (x === 0 && y === 0 ? 4 : 0));
    expect(report.watertight).toBe(true);
    expect(report.bbox.max[2]).toBeCloseTo(spec.zero + 4, 5);
  });

  it('keeps every vertex off the plane to avoid', () => {
    const { mesh } = check(() => 0.01);
    for (let i = 2; i < mesh.positions.length; i += 3) expect(Math.abs(mesh.positions[i] - 3)).toBeGreaterThan(1e-6);
  });

  it('works on a non-square grid with a fractional step', () => {
    const { report } = check((x, y) => Math.max(0, 2 - Math.hypot(x, y)), { width: 7.3, height: 2.1, step: 0.37 });
    expect(report.watertight).toBe(true);
    expect(report.degenerateTriangles).toBe(0);
  });
});
