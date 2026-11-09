import { beforeAll, describe, expect, it } from 'vitest';
import type { Raster } from '../geo/heightmap';
import { meshNormals } from 'maker-kit/3d/mesh';
import { defaultPlate, sanitizeState } from '../geo/state';
import type { TextRaster } from '../geo/textShape';
import { assessExport, validateMesh } from 'maker-kit/3d/validate';
import { LOCALES, messages, staticText } from '../i18n';
import { warnings } from '../geo/warnings';
import { buildPlate, outlineRings, stateOutline } from '../worker/build';
import { CsgScope, initCSG, type CsgApi } from '../worker/csg';
import { BLANK_PRESET, BUILT_IN_PRESETS } from './presets';

const presetById = (id: string) => {
  const found = BUILT_IN_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(id);
  return found;
};

let csg: CsgApi;
beforeAll(async () => {
  csg = await initCSG();
});

/** A picture of mid-gray, opaque: stands in for a decoded PNG, which needs a browser. */
function opaque(width: number, height: number): Raster {
  const data = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) data.set([200, 255], i * 2);
  return { width, height, data };
}

/** A 10 px/mm frame of a 10 mm band around a window, as a vignette's silhouette. */
function frame(w: number, h: number): TextRaster {
  const width = w * 10 + 20;
  const height = h * 10 + 20;
  const data = new Uint8Array(width * height);
  for (let j = 10; j < height - 10; j++)
    for (let i = 10; i < width - 10; i++) if (i < 110 || i >= width - 110 || j < 110 || j >= height - 110) data[j * width + i] = 255;
  return { width, height, data, pxPerMm: 10, originX: width / 2, originY: height / 2, cap: 0 };
}

/** A text as a block of ink, as wide as its letters roughly: stands in for a raster drawn with the font. */
function block(text: { text: string; size: number }): TextRaster {
  const width = Math.round(text.size * 7 * Math.max(...text.text.split('\n').map((l) => l.length))) + 20;
  const height = Math.round(text.size * 10) + 20;
  const data = new Uint8Array(width * height);
  for (let j = 10; j < height - 10; j++) for (let i = 10; i < width - 10; i++) data[j * width + i] = 255;
  return { width, height, data, pxPerMm: 10, originX: width / 2, originY: height / 2, cap: text.size };
}

describe('built-in presets', () => {
  it('have distinct ids and a name in every language', () => {
    expect(new Set(BUILT_IN_PRESETS.map((p) => p.id)).size).toBe(BUILT_IN_PRESETS.length);
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of [...BUILT_IN_PRESETS, BLANK_PRESET])
      for (const locale of LOCALES) expect(staticText(messages[locale], `preset.${preset.id}.name`)).toBeTruthy();
  });

  it.each(BUILT_IN_PRESETS.map((p) => [p.id, p] as const))('%s: sanitising leaves it as it is', (_, preset) => {
    expect(sanitizeState(preset.build())).toEqual(preset.build());
  });

  it.each(BUILT_IN_PRESETS.map((p) => [p.id, p] as const))('%s: builds a valid mesh', (_, preset) => {
    const state = preset.build();
    const scope = new CsgScope();
    try {
      const rasters = {
        images: state.images.map((image) => opaque(image.pixelWidth, image.pixelHeight)),
        texts: state.texts.map((text) => block(text)),
        silhouette: state.plate.kind === 'vignette' ? frame(state.plate.width, state.plate.height) : null,
      };
      const { mesh } = buildPlate(csg, scope, state, rasters, 'preview');
      const report = validateMesh({ ...mesh, normals: meshNormals(mesh.positions, mesh.indices) });
      expect({ watertight: report.watertight, problems: assessExport(report, true).blockers }).toEqual({ watertight: true, problems: [] });
    } finally {
      scope.dispose();
    }
  });
});

describe('the blank preset', () => {
  it('is the default rectangle with nothing on it, named in every language', () => {
    const state = BLANK_PRESET.build();
    expect(sanitizeState(state)).toEqual(state);
    expect(state.plate).toEqual(defaultPlate());
    expect([state.texts, state.images, state.holes, state.magnets.count]).toEqual([[], [], [], 0]);
    expect(BUILT_IN_PRESETS.map((p) => p.id)).not.toContain(BLANK_PRESET.id);
    expect(BLANK_PRESET.listed).toBe(false);
  });
});

describe('edges of the presets', () => {
  it.each([
    ['keychain', 0.8],
    ['pet-tag', 0.8],
    ['medal', 0.8],
    ['fridge-magnet', 1],
    ['door-sign', 0],
    ['house-number', 0],
    ['name-plate', 0],
  ] as const)('%s: a %s mm fillet, no text on it', (id, edgeSize) => {
    const state = presetById(id).build();
    expect([state.plate.edgeSize, state.plate.edgeProfile]).toEqual([edgeSize, 'fillet']);
    const scope = new CsgScope();
    try {
      const rasters = {
        images: state.images.map((image) => opaque(image.pixelWidth, image.pixelHeight)),
        texts: state.texts.map((text) => block(text)),
        silhouette: state.plate.kind === 'vignette' ? frame(state.plate.width, state.plate.height) : null,
      };
      const { section } = stateOutline(csg, scope, state, rasters);
      expect(warnings(state, outlineRings(section)).map((w) => w.code)).not.toContain('text.onEdge');
    } finally {
      scope.dispose();
    }
  });
});

describe('the fridge magnet', () => {
  it('has two 10 × 2 magnets in a row that fit its crop, with no warning', () => {
    const state = presetById('fridge-magnet').build();
    expect(state.plate.kind).toBe('crop');
    expect(state.magnets).toMatchObject({ count: 2, layout: 'row', diameter: 10, thickness: 2 });
    const scope = new CsgScope();
    try {
      const rasters = {
        images: state.images.map((image) => opaque(image.pixelWidth, image.pixelHeight)),
        texts: state.texts.map((text) => block(text)),
      };
      const { section, warnings: outlineWarnings } = stateOutline(csg, scope, state, rasters);
      expect([...outlineWarnings, ...warnings(state, outlineRings(section))]).toEqual([]);
    } finally {
      scope.dispose();
    }
  });
});
