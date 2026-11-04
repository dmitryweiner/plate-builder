import { beforeAll, describe, expect, it } from 'vitest';
import { meshNormals } from '../geo/mesh';
import { bounds, ringArea } from '../geo/outline';
import { defaultHole, defaultState, HOLE_KINDS, PRIMITIVE_KINDS, type HoleElement, type Plate, type PlateState } from '../geo/state';
import { meshProblems, validateMesh } from '../geo/validate';
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

/** A 100 × 60 plate, 6 mm thick, sharp corners, with the given holes. */
function plateWith(holes: Partial<HoleElement>[]): PlateState {
  const state = withPlate({ width: 100, height: 60, thickness: 6, rounding: 0 });
  return { ...state, holes: holes.map((over, i) => ({ ...defaultHole('round'), id: `h${i + 1}`, ...over })) };
}

function holeReport(state: PlateState) {
  const mesh = inScope((scope) => buildMesh(csg, scope, state));
  return { mesh, report: validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) }) };
}

const removed = (state: PlateState) => 100 * 60 * 6 - holeReport(state).report.volume;

describe('holes', () => {
  it.each(HOLE_KINDS)('%s: the plate stays watertight', (kind) => {
    const { report: r } = holeReport(plateWith([{ kind }]));
    expect(r.watertight).toBe(true);
    expect(r.volume).toBeGreaterThan(0);
    expect(meshProblems(r)).toEqual([]);
  });

  it('a round hole removes a cylinder', () => {
    expect(removed(plateWith([{ kind: 'round', diameter: 10 }]))).toBeCloseTo(Math.PI * 25 * 6, -1);
  });

  it('a slot removes a stadium prism', () => {
    expect(removed(plateWith([{ kind: 'slot', length: 20, width: 6, rotation: 30 }]))).toBeCloseTo((14 * 6 + Math.PI * 9) * 6, -1);
  });

  it('a countersunk hole removes a cylinder and a 90° frustum', () => {
    const [r0, r1, cone] = [2.25, 4.25, 2];
    const expected = Math.PI * r0 * r0 * (6 - cone) + ((Math.PI * cone) / 3) * (r0 * r0 + r0 * r1 + r1 * r1);
    expect(Math.abs(removed(plateWith([{ kind: 'countersunk' }])) / expected - 1)).toBeLessThan(0.01);
  });

  it('a keyhole removes the lip slot and the channel, and leaves the front face whole', () => {
    // lip (1.5 mm): the entry circle (r 4) ∪ the shank stadium (r 2, 10 long); the overlap is
    // the half disc at the start and the strip of the rectangle inside the circle
    const strip = 2 * (Math.sqrt(12) + 8 * Math.asin(0.5));
    const lip = Math.PI * 16 + (40 + Math.PI * 4) - (strip + Math.PI * 2);
    // channel (3 mm): the head stadium (r 4, 10 long), which holds the entry circle
    const channel = 80 + Math.PI * 16;
    const expected = lip * 1.5 + channel * 3;
    const state = plateWith([{ kind: 'keyhole' }]);
    expect(Math.abs(removed(state) / expected - 1)).toBeLessThan(0.015);

    const { mesh } = holeReport(state);
    expect(faceArea(mesh, 6)).toBeCloseTo(100 * 60, 3);
    expect(faceArea(mesh, 0)).toBeCloseTo(100 * 60 - lip, 0);
  });

  it('hidden holes cut nothing', () => {
    expect(removed(plateWith([{ kind: 'round', diameter: 10, visible: false }]))).toBeCloseTo(0, 3);
  });

  it('overlapping holes still give a closed solid', () => {
    const { report: r } = holeReport(
      plateWith([
        { kind: 'round', diameter: 10 },
        { kind: 'slot', length: 30, width: 4 },
        { kind: 'countersunk', x: 3 },
      ]),
    );
    expect(r.watertight).toBe(true);
  });
});

/** The area of the horizontal faces at height z (the front face at z = T, the back at 0). */
function faceArea(mesh: { positions: Float32Array; indices: Uint32Array }, z: number): number {
  const { positions: p, indices } = mesh;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    if (Math.abs(p[a + 2] - z) > 1e-4 || Math.abs(p[b + 2] - z) > 1e-4 || Math.abs(p[c + 2] - z) > 1e-4) continue;
    area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2;
  }
  return area;
}
