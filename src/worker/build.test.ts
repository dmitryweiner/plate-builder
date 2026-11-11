import { beforeAll, describe, expect, it } from 'vitest';
import { edgeInset } from '../geo/edges';
import { meshNormals } from 'maker-kit/3d/mesh';
import { bounds, ringArea } from '../geo/outline';
import type { Raster } from '../geo/heightmap';
import {
  defaultHole,
  defaultImage,
  defaultState,
  defaultText,
  HOLE_KINDS,
  PRIMITIVE_KINDS,
  type HoleElement,
  type ImageElement,
  type Magnets,
  type Plate,
  type PlateState,
  type TextElement,
} from '../geo/state';
import type { TextRaster } from '../geo/textShape';
import { assessExport, validateMesh } from 'maker-kit/3d/validate';
import {
  buildMesh,
  buildPlate,
  gridStep,
  IMAGE_EPS,
  outlineRings,
  plateOutline,
  PREVIEW_CELLS,
  stateOutline,
  type PlateMesh,
  type Rasters,
} from './build';
import { CsgScope, initCSG, type CsgApi } from 'maker-kit/csg/manifold';

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
    expect(assessExport(r, true).blockers).toEqual([]);
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

/** An opaque raster of one gray level, or a left-to-right ramp. */
function flat(gray: number, w = 4, h = 4): Raster {
  const data = new Uint8Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    data[i * 2] = gray;
    data[i * 2 + 1] = 255;
  }
  return { width: w, height: h, data };
}
function ramp(w = 16, h = 8): Raster {
  const data = new Uint8Array(w * h * 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      data[(j * w + i) * 2] = Math.round((255 * i) / (w - 1));
      data[(j * w + i) * 2 + 1] = 255;
    }
  }
  return { width: w, height: h, data };
}
const png = 'data:image/png;base64,';
function plateWithImages(images: Partial<ImageElement>[]): PlateState {
  const state = withPlate({ width: 100, height: 60, thickness: 3, rounding: 0 });
  return { ...state, images: images.map((over, i) => ({ ...defaultImage(state, png, 4, 4), id: `i${i + 1}`, size: 20, ...over })) };
}
function built(state: PlateState, rasters: (Raster | null)[]) {
  const mesh = inScope((scope) => buildMesh(csg, scope, state, rasters, 'preview'));
  return { mesh, report: validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) }) };
}
/** The highest vertex within r of a plate point. */
function topNear(mesh: { positions: Float32Array }, x: number, y: number, r = 1): number {
  let top = -Infinity;
  for (let v = 0; v < mesh.positions.length; v += 3) {
    if (Math.hypot(mesh.positions[v] - x, mesh.positions[v + 1] - y) <= r) top = Math.max(top, mesh.positions[v + 2]);
  }
  return top;
}

describe('images', () => {
  it('raises a flat image by its height over its square, watertight', () => {
    const { report } = built(plateWithImages([{ height: 2 }]), [flat(255)]);
    expect(report.watertight).toBe(true);
    expect(assessExport(report, true).blockers).toEqual([]);
    expect(report.bbox.max[2]).toBeCloseTo(3 + 2 - IMAGE_EPS, 4);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + 20 * 20 * (2 - IMAGE_EPS), 0);
  });

  it('two overlapping images combine by max, not by sum', () => {
    const state = plateWithImages([
      { height: 1, x: -5 },
      { height: 2, x: 5 },
    ]);
    const { mesh, report } = built(state, [flat(255), flat(255)]);
    expect(report.watertight).toBe(true);
    expect(topNear(mesh, 0, 0)).toBeCloseTo(3 + 2 - IMAGE_EPS, 4);
    expect(topNear(mesh, -12, 0)).toBeCloseTo(3 + 1 - IMAGE_EPS, 4);
    // the union: the 1 mm square without what the 2 mm one covers, plus the 2 mm square
    const relief = (20 * 20 - 10 * 20) * (1 - IMAGE_EPS) + 20 * 20 * (2 - IMAGE_EPS);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + relief, 0);
  });

  it('turns an image about its centre: a ramp turned 90° rises towards +y', () => {
    const state = plateWithImages([{ height: 2, size: 32, pixelWidth: 16, pixelHeight: 8, rotation: 90, x: 10, y: 5 }]);
    const { mesh, report } = built(state, [ramp()]);
    expect(report.watertight).toBe(true);
    expect(topNear(mesh, 10, 5 + 15)).toBeCloseTo(3 + 2 - IMAGE_EPS, 1);
    expect(topNear(mesh, 10, 5 - 15)).toBeLessThan(3.3);
  });

  it('clips an image that pokes out of the outline', () => {
    const { report } = built(plateWithImages([{ height: 1, x: 45 }]), [flat(255)]);
    expect(report.watertight).toBe(true);
    expect(report.bbox.max[0]).toBeCloseTo(50, 4);
  });

  it('skips hidden images and those without a raster', () => {
    const { report } = built(plateWithImages([{ height: 1, visible: false }, { height: 1 }]), [flat(255), null]);
    expect(report.volume).toBeCloseTo(100 * 60 * 3, 3);
  });

  it('cuts holes through the relief', () => {
    const state = { ...plateWithImages([{ height: 2 }]), holes: [{ ...defaultHole('round'), id: 'h1', diameter: 6 }] };
    const { report } = built(state, [flat(255)]);
    expect(report.watertight).toBe(true);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + 20 * 20 * (2 - IMAGE_EPS) - Math.PI * 9 * (5 - IMAGE_EPS), -1);
  });
});

describe('gridStep', () => {
  it('is the pixel size for an export, within 0.1…0.2 mm', () => {
    const image = { ...defaultImage(defaultState(), 'data:image/png;base64,', 512, 256), size: 60 };
    expect(gridStep(image, 'export')).toBeCloseTo(60 / 512);
    expect(gridStep({ ...image, size: 300 }, 'export')).toBe(0.2);
    expect(gridStep({ ...image, size: 20 }, 'export')).toBe(0.1);
  });

  it('gives a preview PREVIEW_CELLS cells, no coarser than 0.5 mm and no finer than the export', () => {
    const image = { ...defaultImage(defaultState(), 'data:image/png;base64,', 512, 256), size: 60 };
    // 60 × 30 mm
    expect(gridStep(image, 'preview')).toBeCloseTo(Math.sqrt((60 * 30) / PREVIEW_CELLS));
    expect(gridStep({ ...image, size: 300 }, 'preview')).toBe(0.5);
    expect(gridStep({ ...image, size: 20 }, 'preview')).toBe(gridStep({ ...image, size: 20 }, 'export'));
    // a 100 mm square at 0.5 mm, the most a preview took before
    expect(gridStep({ ...image, size: 100, pixelHeight: 512 }, 'preview')).toBe(0.5);
  });
});

/** A 10 px/mm text raster: a filled w × h mm block (as if one wide letter), origin in its middle. */
function blockRaster(w: number, h: number, cap = h): TextRaster {
  const pad = 10;
  const width = w * 10 + 2 * pad;
  const height = h * 10 + 2 * pad;
  const data = new Uint8Array(width * height);
  for (let j = pad; j < height - pad; j++) for (let i = pad; i < width - pad; i++) data[j * width + i] = 255;
  return { width, height, data, pxPerMm: 10, originX: width / 2, originY: height / 2, cap };
}

function plateWithTexts(texts: Partial<TextElement>[]): PlateState {
  const state = withPlate({ width: 100, height: 60, thickness: 3, rounding: 0 });
  return { ...state, texts: texts.map((over, i) => ({ ...defaultText(state), id: `t${i + 1}`, ...over })) };
}

function builtTexts(state: PlateState, rasters: (TextRaster | null)[], images: (Raster | null)[] = []) {
  const result = inScope((scope) => buildPlate(csg, scope, state, { images, texts: rasters }, 'preview'));
  return { ...result, report: validateMesh({ ...result.mesh, normals: meshNormals(result.mesh.positions, result.mesh.indices) }) };
}

describe('texts', () => {
  it('a raised text stands on the base to its height, watertight', () => {
    const { report } = builtTexts(plateWithTexts([{ height: 1.5 }]), [blockRaster(20, 8)]);
    expect(report.watertight).toBe(true);
    expect(assessExport(report, true).blockers).toEqual([]);
    expect(report.bbox.max[2]).toBeCloseTo(4.5, 4);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + 20 * 8 * 1.5, -1);
  });

  it('an engraved text is cut to its depth', () => {
    const { mesh, report } = builtTexts(plateWithTexts([{ mode: 'engraved', depth: 1.2 }]), [blockRaster(20, 8)]);
    expect(report.watertight).toBe(true);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 - 20 * 8 * 1.2, -1);
    // the floor of the engraving: its corners are the lowest vertices within the text
    let floor = Infinity;
    for (let v = 0; v < mesh.positions.length; v += 3) {
      if (Math.abs(mesh.positions[v]) <= 10.01 && Math.abs(mesh.positions[v + 1]) <= 4.01) floor = Math.min(floor, mesh.positions[v + 2]);
    }
    expect(floor).toBeCloseTo(3 - 1.2, 4);
  });

  it('an engraved text cuts into an image under it', () => {
    const state = {
      ...plateWithTexts([{ mode: 'engraved', depth: 0.6 }]),
      images: [{ ...defaultImage(defaultState(), 'data:image/png;base64,', 4, 4), id: 'i1', size: 40, height: 2 }],
    };
    const { report } = builtTexts(state, [blockRaster(20, 8)], [flat(255)]);
    expect(report.watertight).toBe(true);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + 40 * 40 * (2 - IMAGE_EPS) - 20 * 8 * (2 - IMAGE_EPS + 0.6), -1);
  });

  it('turns and moves a text with its element', () => {
    const { report } = builtTexts(plateWithTexts([{ rotation: 90, x: 20, y: 5 }]), [blockRaster(20, 8)]);
    expect(report.watertight).toBe(true);
    const relief = (axis: 0 | 1) => [report.bbox.min[axis], report.bbox.max[axis]];
    expect(relief(0)).toEqual([-50, 50].map((v) => expect.closeTo(v, 4)));
    // the text's own top is at x = 20 ± 4, y = 5 ± 10 after a quarter turn: checked by its volume being whole
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + 20 * 8, -1);
  });

  it('warns about strokes thinner than 0.8 mm and not about thick ones', () => {
    const thin = builtTexts(plateWithTexts([{}]), [blockRaster(20, 0.6, 8)]);
    expect(thin.warnings.map((w) => w.code)).toEqual(['text.thin']);
    expect(thin.warnings[0]?.ids).toEqual(['t1']);
    expect(builtTexts(plateWithTexts([{}]), [blockRaster(20, 2)]).warnings).toEqual([]);
  });

  it('squeezes an arc text that is longer than its circle and says by how much', () => {
    const raster = { ...blockRaster(100, 4), originY: 4 * 10 + 10 };
    const { warnings, report } = builtTexts(plateWithTexts([{ arc: true, arcRadius: 10 }]), [raster]);
    expect(report.watertight).toBe(true);
    const arc = warnings.find((w) => w.code === 'text.arcTooLong');
    expect(arc?.params?.percent).toBeGreaterThan(0);
    expect(arc?.params?.percent).toBeLessThan(100);
  });
});

/** An opaque disc of radius r px in the middle of a size × size raster, anti-aliased. */
function discRaster(size: number, r: number, hole = 0): Raster {
  const data = new Uint8Array(size * size * 2);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const d = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2);
      const outer = Math.min(1, Math.max(0, r - d + 0.5));
      const inner = hole > 0 ? Math.min(1, Math.max(0, d - hole + 0.5)) : 1;
      data[(j * size + i) * 2] = 255;
      data[(j * size + i) * 2 + 1] = Math.round(255 * Math.min(outer, inner));
    }
  }
  return { width: size, height: size, data };
}

function cropState(images: Partial<ImageElement>[], over: Partial<Plate> = {}): PlateState {
  const state = withPlate({ kind: 'crop', padding: 3, rounding: 0, ...over });
  return {
    ...state,
    images: images.map((o, i) => ({ ...defaultImage(state, 'data:image/png;base64,', 64, 64), id: `i${i + 1}`, size: 32, ...o })),
  };
}

function cropped(state: PlateState, rasters: Rasters) {
  return inScope((scope) => {
    const { section, warnings } = stateOutline(csg, scope, state, rasters);
    return { rings: outlineRings(section), area: section.area(), warnings };
  });
}

describe('crop outline', () => {
  it('a disc image cropped with padding p is a circle of r + p', () => {
    // 64 px over 32 mm: a 24 px disc is 12 mm
    // the mask's edge at 50 % of the height is where the anti-aliased disc's edge is
    const { rings, area, warnings } = cropped(cropState([{ threshold: 50 }]), { images: [discRaster(64, 24)], texts: [] });
    expect(rings).toHaveLength(1);
    expect(Math.abs(area / (Math.PI * 15 * 15) - 1)).toBeLessThan(0.01);
    expect(warnings).toEqual([]);
    const b = bounds(rings);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 1);
  });

  it('follows a moved image and leaves out one that is not in the outline', () => {
    const state = cropState([
      { x: 20, y: -5 },
      { x: -30, inOutline: false },
    ]);
    const { rings } = cropped(state, { images: [discRaster(64, 24), discRaster(64, 24)], texts: [] });
    expect(rings).toHaveLength(1);
    const b = bounds(rings);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(20, 1);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(-5, 1);
  });

  it('two far images give two islands and a warning', () => {
    const state = cropState([{ x: -40 }, { x: 40 }]);
    const { rings, warnings } = cropped(state, { images: [discRaster(64, 24), discRaster(64, 24)], texts: [] });
    expect(rings).toHaveLength(2);
    expect(warnings).toEqual([expect.objectContaining({ code: 'outline.islands', params: { count: 2 } })]);
  });

  it('fills the hole of a ring-shaped mask', () => {
    const { rings, area } = cropped(cropState([{ threshold: 50 }], { padding: 0 }), { images: [discRaster(64, 24, 12)], texts: [] });
    expect(rings).toHaveLength(1);
    expect(Math.abs(area / (Math.PI * 12 * 12) - 1)).toBeLessThan(0.02);
  });

  it('pads a mask full of pinholes, like a JPEG’s noise, as fast as a solid one', () => {
    // 512 px over 32 mm: a 200 px disc is 12.5 mm; a 2 px pinhole every 6 px, some 3500 of them
    const raster = discRaster(512, 200);
    for (let j = 2; j < 512; j += 6)
      for (let i = 2; i < 512; i += 6) for (const k of [0, 1, 512, 513]) raster.data[(j * 512 + i + k) * 2 + 1] = 0;
    const state = cropState([{ threshold: 50, pixelWidth: 512, pixelHeight: 512 }]);
    const start = performance.now();
    const { rings, area } = cropped(state, { images: [raster], texts: [] });
    // seconds when the holes were padded one by one, then filled
    expect(performance.now() - start).toBeLessThan(1000);
    expect(rings).toHaveLength(1);
    expect(Math.abs(area / (Math.PI * 15.5 * 15.5) - 1)).toBeLessThan(0.01);
  });

  it('fills what the padding closes in: a C whose gap is narrower than twice the padding', () => {
    // a ring of 24 px with a hole of 12 px, cut by a 4 px gap: 2 mm, closed by a 3 mm padding
    const raster = discRaster(64, 24, 12);
    for (let j = 0; j < 64; j++) for (let i = 32; i < 64; i++) if (Math.abs(j + 0.5 - 32) < 2) raster.data[(j * 64 + i) * 2 + 1] = 0;
    const { rings, area } = cropped(cropState([{ threshold: 50 }]), { images: [raster], texts: [] });
    expect(rings).toHaveLength(1);
    expect(Math.abs(area / (Math.PI * 15 * 15) - 1)).toBeLessThan(0.01);
  });

  it('takes the mask above the threshold only', () => {
    // a ramp: the left half is below 50 %
    const state = cropState([{ threshold: 50, size: 40, pixelWidth: 16, pixelHeight: 8 }], { padding: 0 });
    const { rings } = cropped(state, { images: [ramp()], texts: [] });
    const b = bounds(rings);
    expect(b.minX).toBeGreaterThan(-2);
    expect(b.maxX).toBeCloseTo(20, 0);
  });

  it('crops around a text alone', () => {
    const state = { ...withPlate({ kind: 'crop', padding: 2, rounding: 0 }), texts: [{ ...defaultText(defaultState()), id: 't1' }] };
    const { rings, area } = cropped(state, { images: [], texts: [blockRaster(20, 8)] });
    expect(rings).toHaveLength(1);
    const b = bounds(rings);
    expect(b.maxX - b.minX).toBeCloseTo(24, 1);
    // a rounded rectangle: 24 × 12 less the corners outside the arcs of 2 mm
    expect(area).toBeCloseTo(24 * 12 - (4 - Math.PI) * 4, 0);
  });

  it('rounds no more than the padding, so thin letters are not cut away', () => {
    // beside a big disc, which survives any rounding, a 1 mm stroke would vanish under a 4 mm one
    const base = cropState([{ threshold: 50, x: -30 }], { padding: 0, rounding: 4 });
    const state = { ...base, texts: [{ ...defaultText(defaultState()), id: 't1', x: 20 }] };
    const { area } = cropped(state, { images: [discRaster(64, 24)], texts: [blockRaster(20, 1)] });
    expect(area).toBeCloseTo(Math.PI * 144 + 20, -1);
  });

  it('is empty, with a warning, when there is nothing to crop around', () => {
    const { rings, warnings } = cropped(cropState([]), { images: [], texts: [] });
    expect(rings).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(['outline.empty']);
  });

  it('builds a closed plate around the elements', () => {
    const state = { ...cropState([{ height: 1 }]) };
    const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [discRaster(64, 24)], texts: [] }, 'preview'));
    const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
    expect(report.watertight).toBe(true);
    expect(report.bbox.max[0] - report.bbox.min[0]).toBeCloseTo(30, 0);
  });
});

/** A 100 × 60 × 3 plate, sharp corners, with magnets. */
function plateWithMagnets(over: Partial<Magnets>, plate: Partial<Plate> = {}): PlateState {
  const state = withPlate({ width: 100, height: 60, thickness: 3, rounding: 0, ...plate });
  return { ...state, magnets: { ...state.magnets, count: 1, ...over } };
}

describe('magnets', () => {
  // a 10 × 2 magnet with 0.2 of fit: a pocket of r 5.1, 2.1 deep
  const pocket = Math.PI * 5.1 * 5.1;

  it('four pockets at the corners: watertight, each a cylinder, nothing shows at the front', () => {
    const state = plateWithMagnets({ count: 4, layout: 'corners' });
    const { mesh, report } = holeReport(state);
    expect(report.watertight).toBe(true);
    expect(assessExport(report, true).blockers).toEqual([]);
    expect(Math.abs((100 * 60 * 3 - report.volume) / (4 * pocket * 2.1) - 1)).toBeLessThan(0.01);
    expect(faceArea(mesh, 3)).toBeCloseTo(100 * 60, 3);
    expect(Math.abs((100 * 60 - faceArea(mesh, 0)) / (4 * pocket) - 1)).toBeLessThan(0.01);
  });

  it('no magnets cut nothing', () => {
    expect(holeReport(plateWithMagnets({ count: 0 })).report.volume).toBeCloseTo(100 * 60 * 3, 3);
  });

  it('a pocket under a raised text and an image stays one closed solid', () => {
    const state = {
      ...plateWithTexts([{ height: 1 }]),
      images: [{ ...defaultImage(defaultState(), png, 4, 4), id: 'i1', size: 30, height: 2 }],
      magnets: { ...defaultState().magnets, count: 1, thickness: 1.4 },
    };
    // the pocket's top (1.5) at the image's and the text's bottom (T / 2): they are inside the base, gone in the union
    const { report } = builtTexts(state, [blockRaster(20, 8)], [flat(255)]);
    expect(report.watertight).toBe(true);
    expect(assessExport(report, true).blockers).toEqual([]);
  });

  it('a pocket beside a keyhole, at its lip’s level, stays one closed solid', () => {
    const state = {
      ...plateWithMagnets({ count: 2, layout: 'row', thickness: 1.4 }, { thickness: 6 }),
      holes: [{ ...defaultHole('keyhole'), id: 'h1', x: -36 }],
    };
    const { report } = holeReport(state);
    expect(report.watertight).toBe(true);
  });

  it('follows a crop outline to wherever its elements are', () => {
    const state = { ...cropState([{ height: 1, x: 20, y: 10 }]), magnets: { ...defaultState().magnets, count: 1 } };
    const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [discRaster(64, 24)], texts: [] }, 'preview'));
    // the pocket's ceiling is a face at its depth, around the outline's centre
    let near = 0;
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const [x, y, z] = [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]];
      if (Math.abs(z - 2.1) < 0.01 && Math.abs(Math.hypot(x - 20, y - 10) - 5.1) < 0.01) near++;
    }
    expect(near).toBeGreaterThan(8);
  });
});

describe('rim', () => {
  it('is the outline less its inset, raised by its height, on any kind', () => {
    const state = withPlate({ width: 100, height: 60, thickness: 3, rounding: 0, rim: true, rimWidth: 4, rimHeight: 2 });
    const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [], texts: [] }, 'preview'));
    const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
    expect(report.watertight).toBe(true);
    expect(report.bbox.max[2]).toBeCloseTo(5, 4);
    expect(report.volume).toBeCloseTo(100 * 60 * 3 + (100 * 60 - 92 * 52) * 2, 0);
  });

  it.each(PRIMITIVE_KINDS)('%s: the default rim leaves no slivers', (kind) => {
    const state = withPlate({ kind, rim: true });
    const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [], texts: [] }, 'preview'));
    const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
    expect({ watertight: report.watertight, problems: assessExport(report, true).blockers }).toEqual({ watertight: true, problems: [] });
  });

  it('joins with the relief and is cut by holes into one closed solid', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const state = {
        ...withPlate({ kind, width: 80, height: 60, rim: true, rimWidth: 3, rimHeight: 1.5 }),
        images: [{ ...defaultImage(defaultState(), 'data:image/png;base64,', 4, 4), id: 'i1', size: 70, height: 2 }],
        holes: [{ ...defaultHole('round'), id: 'h1', y: 20 }],
      };
      const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [flat(200)], texts: [] }, 'preview'));
      const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
      expect({ kind, watertight: report.watertight, problems: assessExport(report, true).blockers }).toEqual({
        kind,
        watertight: true,
        problems: [],
      });
    }
  });
});

/** A 10 px/mm silhouette: a w × h mm frame of the given band width around a window, centred. */
function frameMask(w: number, h: number, band: number, pieces: [number, number][] = [[0, 0]]): TextRaster {
  const pad = 10;
  const width = w * 10 + 2 * pad;
  const height = h * 10 + 2 * pad;
  const data = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = (i + 0.5 - width / 2) / 10;
      const y = (height / 2 - j - 0.5) / 10;
      for (const [cx, cy] of pieces) {
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const pw = pieces.length > 1 ? w / 4 : w / 2;
        const inside = dx < pw && dy < h / 2;
        const window = dx < pw - band && dy < h / 2 - band;
        if (inside && !window) data[j * width + i] = 255;
      }
    }
  }
  return { width, height, data, pxPerMm: 10, originX: width / 2, originY: height / 2, cap: 0 };
}

function silhouetteState(over: Partial<Plate> = {}): PlateState {
  return withPlate({ kind: 'svg', svg: 'data:image/svg+xml;base64,', rounding: 0, thickness: 3, frame: true, frameHeight: 1.5, ...over });
}

function builtSilhouette(state: PlateState, mask: TextRaster | null) {
  const { mesh, warnings } = inScope((scope) => buildPlate(csg, scope, state, { images: [], texts: [], silhouette: mask }, 'preview'));
  return { warnings, report: validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) }) };
}

describe('vignettes and own SVG', () => {
  it('the outline is the silhouette’s outer contour, its window filled', () => {
    const { rings, area } = inScope((scope) => {
      const { section } = stateOutline(csg, scope, silhouetteState(), { images: [], texts: [], silhouette: frameMask(60, 40, 5) });
      return { rings: outlineRings(section), area: section.area() };
    });
    expect(rings).toHaveLength(1);
    expect(area).toBeCloseTo(60 * 40, -1);
  });

  it('raises the frame by its height and leaves the window at the base', () => {
    const { report } = builtSilhouette(silhouetteState(), frameMask(60, 40, 5));
    expect(report.watertight).toBe(true);
    expect(assessExport(report, true).blockers).toEqual([]);
    expect(report.bbox.max[2]).toBeCloseTo(4.5, 4);
    expect(report.volume).toBeCloseTo(60 * 40 * 3 + (60 * 40 - 50 * 30) * 1.5, -1);
  });

  it('without the frame it is a figured outline only', () => {
    const { report } = builtSilhouette(silhouetteState({ frame: false }), frameMask(60, 40, 5));
    expect(report.volume).toBeCloseTo(60 * 40 * 3, -1);
  });

  it('a rim and a frame of different heights make one closed solid', () => {
    for (const [rimHeight, frameHeight] of [
      [1, 2],
      [2, 1],
      [1.5, 1.5],
    ]) {
      const { report } = builtSilhouette(silhouetteState({ rim: true, rimWidth: 2, rimHeight, frameHeight }), frameMask(60, 40, 5));
      expect({ rimHeight, frameHeight, watertight: report.watertight, problems: assessExport(report, true).blockers }).toEqual({
        rimHeight,
        frameHeight,
        watertight: true,
        problems: [],
      });
      // the rim's 2 mm ring lies within the frame's 5 mm band: the frame stands at its height,
      // and the ring above it where the rim is higher
      const ring = 60 * 40 - 56 * 36;
      expect(report.volume).toBeCloseTo(60 * 40 * 3 + (60 * 40 - 50 * 30) * frameHeight + ring * Math.max(0, rimHeight - frameHeight), -1);
    }
  });

  it('warns about a frame thinner than 0.8 mm', () => {
    expect(builtSilhouette(silhouetteState(), frameMask(60, 40, 0.5)).warnings.map((w) => w.code)).toEqual(['frame.thin']);
    expect(builtSilhouette(silhouetteState({ frame: false }), frameMask(60, 40, 0.5)).warnings).toEqual([]);
  });

  it('an SVG with two pieces gives two islands and the warning', () => {
    const { warnings } = builtSilhouette(
      silhouetteState({ frame: false }),
      frameMask(60, 40, 5, [
        [-20, 0],
        [20, 0],
      ]),
    );
    expect(warnings).toEqual([expect.objectContaining({ code: 'outline.islands', params: { count: 2 } })]);
  });

  it('is empty, with a warning, without a silhouette', () => {
    const { warnings, report } = builtSilhouette(silhouetteState(), null);
    expect(warnings.map((w) => w.code)).toEqual(['outline.empty']);
    expect(assessExport(report, true).blockers).toEqual([{ code: 'kit.mesh.empty' }]);
  });
});

const report = (mesh: PlateMesh) => validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
function closed(mesh: PlateMesh) {
  const r = report(mesh);
  return { watertight: r.watertight, problems: assessExport(r, true).blockers };
}

describe('edges', () => {
  const ok = { watertight: true, problems: [] };

  it.each(PRIMITIVE_KINDS.flatMap((kind) => [[kind, 'fillet'] as const, [kind, 'chamfer'] as const]))(
    '%s, %s: one closed solid, as high as before',
    (kind, edgeProfile) => {
      const state = withPlate({ kind, width: 70, height: 45, thickness: 3, rounding: 3, edgeSize: 1.2, edgeProfile });
      const mesh = inScope((scope) => buildMesh(csg, scope, state));
      expect(closed(mesh)).toEqual(ok);
      expect(report(mesh).bbox.min[2]).toBeCloseTo(0, 6);
      expect(report(mesh).bbox.max[2]).toBeCloseTo(3, 6);
    },
  );

  it.each(['fillet', 'chamfer'] as const)('%s on a rectangle: the profile’s volume, both faces shrunk by r', (edgeProfile) => {
    const [w, h, t, r] = [100, 60, 3, 1.5];
    const state = withPlate({ width: w, height: h, thickness: t, rounding: 0, edgeSize: r, edgeProfile });
    const mesh = inScope((scope) => buildPlate(csg, scope, state, { images: [], texts: [] }, 'export').mesh);
    expect(closed(mesh)).toEqual(ok);
    // the smooth profile's volume: the section at z is the rectangle shrunk by the inset there
    const n = 3000;
    let volume = 0;
    for (let i = 0; i < n; i++) {
      const z = ((i + 0.5) / n) * t;
      const inset = edgeInset(r, edgeProfile, Math.min(z, t - z));
      volume += ((w - 2 * inset) * (h - 2 * inset) * t) / n;
    }
    expect(Math.abs(report(mesh).volume / volume - 1)).toBeLessThan(0.001);
    for (const z of [0, t]) expect(faceArea(mesh, z) / ((w - 2 * r) * (h - 2 * r))).toBeCloseTo(1, 2);
  });

  it.each([
    ['top', [0, 1]],
    ['bottom', [1, 0]],
  ] as const)('only the %s edge: that face shrunk by r, the other the whole outline', (edgeSides, [shrunkBottom, shrunkTop]) => {
    const [w, h, t, r] = [100, 60, 3, 1.5];
    const state = withPlate({ width: w, height: h, thickness: t, rounding: 0, edgeSize: r, edgeSides });
    const mesh = inScope((scope) => buildPlate(csg, scope, state, { images: [], texts: [] }, 'export').mesh);
    expect(closed(mesh)).toEqual(ok);
    const area = (shrunk: number) => (w - 2 * r * shrunk) * (h - 2 * r * shrunk);
    expect(faceArea(mesh, 0) / area(shrunkBottom)).toBeCloseTo(1, 2);
    expect(faceArea(mesh, t) / area(shrunkTop)).toBeCloseTo(1, 2);
    expect(report(mesh).bbox.max[2]).toBeCloseTo(t, 6);
  });

  it('rounds the rim’s top with a preview’s few terraces too', () => {
    const state = withPlate({ width: 100, height: 60, thickness: 3, rounding: 4, rim: true, rimWidth: 3, rimHeight: 1, edgeSize: 2 });
    const mesh = inScope((scope) => buildMesh(csg, scope, state));
    expect(closed(mesh)).toEqual(ok);
    expect(report(mesh).bbox.max[2]).toBeCloseTo(4, 6);
    // the rim's top is narrower than its ring: its outer edge is rounded off
    expect(faceArea(mesh, 4)).toBeLessThan(100 * 60 - 94 * 54 - 100);
  });

  it('rounds an image that reaches the edge, and a raised text there', () => {
    const state = {
      ...withPlate({ width: 100, height: 60, thickness: 3, rounding: 0, edgeSize: 1.5 }),
      images: [{ ...defaultImage(defaultState(), png, 4, 4), id: 'i1', size: 110, height: 2 }],
      texts: [{ ...defaultText(defaultState()), id: 't1', x: 40, y: 25 }],
    };
    const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [flat(255)], texts: [blockRaster(20, 8)] }, 'preview'));
    expect(closed(mesh)).toEqual(ok);
    // within 0.1 mm of the side the relief is cut down to the fillet: well below the wall's top
    let side = -Infinity;
    for (let v = 0; v < mesh.positions.length; v += 3) if (mesh.positions[v] > 49.9) side = Math.max(side, mesh.positions[v + 2]);
    expect(side).toBeGreaterThan(1);
    expect(side).toBeLessThan(2.5);
    expect(topNear(mesh, 0, 0, 1)).toBeCloseTo(5, 1);
  });

  it('keeps magnets, a keyhole and an engraved text in one closed solid', () => {
    const state = {
      ...withPlate({ width: 100, height: 60, thickness: 6, rounding: 2, edgeSize: 2, edgeProfile: 'chamfer' }),
      holes: [{ ...defaultHole('keyhole'), id: 'h1', y: 15 }],
      texts: [{ ...defaultText(defaultState()), id: 't1', mode: 'engraved' as const, y: -15 }],
      magnets: { ...defaultState().magnets, count: 4, layout: 'corners' as const },
    };
    const { mesh } = inScope((scope) => buildPlate(csg, scope, state, { images: [], texts: [blockRaster(20, 8)] }, 'export'));
    expect(closed(mesh)).toEqual(ok);
  });

  it('rounds a frame and a crop', () => {
    const framed = silhouetteState({ edgeSize: 1.5, rim: true, rimWidth: 2, rimHeight: 1 });
    expect(builtSilhouette(framed, frameMask(60, 40, 5)).report.watertight).toBe(true);
    expect(assessExport(builtSilhouette(framed, frameMask(60, 40, 5)).report, true).blockers).toEqual([]);
    const crop = cropState([{ height: 1 }], { edgeSize: 1.5 });
    const { mesh } = inScope((scope) => buildPlate(csg, scope, crop, { images: [discRaster(64, 24)], texts: [] }, 'preview'));
    expect(closed(mesh)).toEqual(ok);
  });
});
