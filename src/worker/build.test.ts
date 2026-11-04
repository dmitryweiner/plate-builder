import { beforeAll, describe, expect, it } from 'vitest';
import { meshNormals } from '../geo/mesh';
import { bounds, ringArea } from '../geo/outline';
import { defaultState, PRIMITIVE_KINDS, type Plate, type PlateState } from '../geo/state';
import { validateMesh } from '../geo/validate';
import { buildMesh, outlineRings, plateOutline } from './build';
import { CsgScope, initCSG, type CsgApi } from './csg';

let csg: CsgApi;
beforeAll(async () => {
  csg = await initCSG();
});

function withPlate(over: Partial<Plate>): PlateState {
  const state = defaultState();
  return { ...state, plate: { ...state.plate, ...over } };
}

function inScope<T>(fn: (scope: CsgScope) => T): T {
  const scope = new CsgScope();
  try {
    return fn(scope);
  } finally {
    scope.dispose();
  }
}

describe('plateOutline', () => {
  it.each(PRIMITIVE_KINDS)('%s: rounding keeps the size', (kind) => {
    const rings = inScope((scope) => outlineRings(plateOutline(csg, scope, withPlate({ kind, width: 90, height: 60, rounding: 5 }).plate)));
    const box = bounds(rings);
    expect(box.maxX - box.minX).toBeCloseTo(90, 6);
    expect(box.maxY - box.minY).toBeCloseTo(60, 6);
    expect((box.maxX + box.minX) / 2).toBeCloseTo(0, 6);
    expect((box.maxY + box.minY) / 2).toBeCloseTo(0, 6);
    expect(rings.every((ring) => ringArea(ring) > 0)).toBe(true);
  });

  it('turns a rectangle corner into an arc of the rounding radius', () => {
    const [w, h, r] = [80, 50, 6];
    const rings = inScope((scope) => outlineRings(plateOutline(csg, scope, withPlate({ width: w, height: h, rounding: r }).plate)));
    expect(rings).toHaveLength(1);
    const corner = (rings[0] ?? []).filter(([x, y]) => x > w / 2 - r + 1e-6 && y > h / 2 - r + 1e-6);
    expect(corner.length).toBeGreaterThan(3);
    for (const [x, y] of corner) expect(Math.hypot(x - (w / 2 - r), y - (h / 2 - r))).toBeCloseTo(r, 4);
    expect(ringArea(rings[0] ?? [])).toBeCloseTo(w * h - (4 - Math.PI) * r * r, 0);
  });

  it('keeps sharp corners without rounding', () => {
    const rings = inScope((scope) => outlineRings(plateOutline(csg, scope, withPlate({ width: 80, height: 50, rounding: 0 }).plate)));
    expect(rings[0]).toHaveLength(4);
  });

  it('lowers a rounding that would make the outline vanish', () => {
    const rings = inScope((scope) =>
      outlineRings(plateOutline(csg, scope, withPlate({ kind: 'star', width: 60, height: 60, rounding: 30, innerRatio: 0.2 }).plate)),
    );
    expect(rings.length).toBeGreaterThan(0);
    const box = bounds(rings);
    expect(box.maxX - box.minX).toBeCloseTo(60, 6);
  });
});

describe('buildMesh', () => {
  it.each(PRIMITIVE_KINDS)('%s: the base is watertight with volume = area × T', (kind) => {
    const state = withPlate({ kind, width: 70, height: 45, thickness: 2.5, rounding: 3 });
    const { mesh, area } = inScope((scope) => {
      const outline = plateOutline(csg, scope, state.plate);
      return { mesh: buildMesh(csg, scope, state), area: outline.area() };
    });
    const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
    expect(report.watertight).toBe(true);
    expect(report.degenerateTriangles).toBe(0);
    expect(report.volume).toBeCloseTo(area * 2.5, 1);
    expect(report.bbox.min[2]).toBeCloseTo(0, 6);
    expect(report.bbox.max[2]).toBeCloseTo(2.5, 6);
  });

  it('has the formula volume for a plain rectangle', () => {
    const mesh = inScope((scope) => buildMesh(csg, scope, withPlate({ width: 100, height: 60, thickness: 3, rounding: 0 })));
    const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
    expect(report.volume).toBeCloseTo(100 * 60 * 3, 3);
  });
});
