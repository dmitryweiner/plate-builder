// The recipe of the solid (spec §6), step by step as the milestones bring
// the parts. Now: the outline with its rounded corners, extruded into the
// base.
//
//   plate = ( base ∪ rim ∪ frame ∪ images ∪ raised texts ) ∩ outline prism (edges rounded or chamfered)
//           − engraved texts − holes − magnet pockets

import type { CrossSection, Manifold } from 'manifold-3d';
import { elementBox } from '../geo/boxes';
import { EDGE_STEP, edgeSlabs } from '../geo/edges';
import { heightfieldMesh } from '../geo/grid';
import { traceContours, LEVEL } from '../geo/contour';
import { heightField, processPixels, sampleField, type Raster } from '../geo/heightmap';
import { holeCutters, type Cutter } from '../geo/holes';
import { magnetCutters } from '../geo/magnets';
import { CHORD_TOLERANCE, primitiveOutline, ringArea, segmentsFor, type Ring } from '../geo/outline';
import { PRIMITIVE_KINDS, type ImageElement, type Plate, type PlateState, type PrimitiveKind, type TextElement } from '../geo/state';
import { maskRings, textRings, type TextRaster } from '../geo/textShape';
import type { Warning } from '../geo/warnings';
import type { CsgApi, CsgScope } from './csg';

const isPrimitive = (kind: Plate['kind']): kind is PrimitiveKind => PRIMITIVE_KINDS.some((k) => k === kind);

/**
 * Corner rounding (spec §2.2): shrink by r and grow back with round joins —
 * every convex corner becomes an arc of radius r. A radius that makes the
 * outline vanish is lowered until it does not.
 */
function roundCorners(scope: CsgScope, section: CrossSection, radius: number): CrossSection {
  for (let r = radius, tries = 0; r > CHORD_TOLERANCE && tries < 16; r *= 0.8, tries++) {
    const segments = segmentsFor(r);
    const shrunk = scope.keep(section.offset(-r, 'Round', 2, segments));
    if (shrunk.isEmpty() || shrunk.area() < 1e-6) continue;
    const grown = scope.keep(shrunk.offset(r, 'Round', 2, segments));
    return scope.keep(grown.simplify(CHORD_TOLERANCE / 10));
  }
  return section;
}

/** Stretches a section so that its box is exactly width × height around the origin. */
function fitBox(scope: CsgScope, section: CrossSection, width: number, height: number): CrossSection {
  const { min, max } = section.bounds();
  const sx = width / (max[0] - min[0]);
  const sy = height / (max[1] - min[1]);
  if (Math.abs(sx - 1) < 1e-12 && Math.abs(sy - 1) < 1e-12 && Math.abs(min[0] + max[0]) < 1e-12 && Math.abs(min[1] + max[1]) < 1e-12)
    return section;
  const centred = scope.keep(section.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2]));
  return scope.keep(centred.scale([sx, sy]));
}

/**
 * The plate's outline as a cross-section. Rounding a pointed shape (a
 * triangle's apex) pulls it in, so primitives are stretched back to their
 * size afterwards: the size the person typed is the size printed.
 */
export function plateOutline(csg: CsgApi, scope: CsgScope, plate: Plate): CrossSection {
  // vignettes, own SVG and the crop arrive in M5–M6; until then they are a rectangle
  const kind = isPrimitive(plate.kind) ? plate.kind : 'rectangle';
  const ring = primitiveOutline({ ...plate, kind });
  const raw = scope.keep(new csg.CrossSection([ring], 'Positive'));
  if (plate.rounding <= 0) return raw;
  return fitBox(scope, roundCorners(scope, raw, plate.rounding), plate.width, plate.height);
}

/** A mask's contours in pixels (y up) → an image's footprint above its crop threshold, plate frame. */
function imageMask(csg: CsgApi, scope: CsgScope, image: ImageElement, raster: Raster): CrossSection | null {
  const field = processPixels(raster, image);
  const threshold = image.threshold / 100;
  // the threshold maps to the tracing level, linearly, so the contour keeps its sub-pixel place
  const data = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(LEVEL + (field[i] - threshold) * 255)));
  const pixels = traceContours({ width: raster.width, height: raster.height, data });
  if (pixels.length === 0) return null;
  const box = elementBox(image);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const rings = pixels.map((ring) =>
    ring.map(([x, y]): [number, number] => [(x * w) / raster.width - w / 2, (y * h) / raster.height - h / 2]),
  );
  const local = scope.keep(new csg.CrossSection(rings, 'Positive'));
  const turned = scope.keep(local.rotate(image.rotation));
  return scope.keep(turned.translate([image.x, image.y]));
}

/** Only the outer contours: holes filled (spec §2.4, §2.5). */
function fillHoles(csg: CsgApi, scope: CsgScope, section: CrossSection): CrossSection | null {
  const outer = section.toPolygons().filter((ring) => ringArea(ring.map(([x, y]): [number, number] => [x, y])) > 0);
  return outer.length ? scope.keep(new csg.CrossSection(outer, 'Positive')) : null;
}

function islandWarnings(section: CrossSection): Warning[] {
  const islands = section.toPolygons().filter((ring) => ringArea(ring.map(([x, y]): [number, number] => [x, y])) > 0).length;
  if (islands <= 1) return [];
  const { min, max } = section.bounds();
  return [{ code: 'outline.islands', ids: [], params: { count: islands }, spot: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] }];
}

// manifold cannot make a cross-section of no polygons; a square of no size is its empty one
const emptyOutline = (csg: CsgApi, scope: CsgScope): { section: CrossSection; warnings: Warning[] } => ({
  section: scope.keep(csg.CrossSection.square([0, 0])),
  warnings: [{ code: 'outline.empty', ids: [], spot: [0, 0] }],
});

/** A silhouette's contours around its middle, mm (spec §2.5); null without ink. */
function maskSection(csg: CsgApi, scope: CsgScope, mask: TextRaster): CrossSection | null {
  const rings = maskRings(mask);
  return rings.length ? scope.keep(new csg.CrossSection(rings, 'Positive')) : null;
}

/**
 * The crop outline (spec §2.4): the elements' masks unioned, grown by the
 * padding with round joins, their holes filled (outer contours only), then
 * corner rounding.
 */
function cropOutline(csg: CsgApi, scope: CsgScope, state: PlateState, rasters: Rasters): { section: CrossSection; warnings: Warning[] } {
  const masks: CrossSection[] = [];
  state.images.forEach((image, i) => {
    const raster = rasters.images[i];
    const mask = image.visible && image.inOutline && raster ? imageMask(csg, scope, image, raster) : null;
    if (mask) masks.push(mask);
  });
  state.texts.forEach((text, i) => {
    const raster = rasters.texts[i];
    const made = text.visible && text.inOutline && raster ? textSection(csg, scope, text, raster) : null;
    if (made) masks.push(made.section);
  });
  if (masks.length === 0) return emptyOutline(csg, scope);
  const union = scope.keep(csg.CrossSection.union(masks));
  const { padding } = state.plate;
  const padded = padding > 0 ? scope.keep(union.offset(padding, 'Round', 2, segmentsFor(padding))) : union;
  const filled = fillHoles(csg, scope, padded);
  if (!filled) return emptyOutline(csg, scope);
  // rounding is an opening: more of it than the padding would cut away strokes the padding did not cover
  const rounding = Math.min(state.plate.rounding, padding);
  const section = rounding > 0 ? roundCorners(scope, filled, rounding) : filled;
  return { section, warnings: islandWarnings(section) };
}

/** A vignette's or own SVG's outline: the silhouette's outer contours, then corner rounding. */
function silhouetteOutline(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  rasters: Rasters,
): { section: CrossSection; warnings: Warning[]; silhouette?: CrossSection } {
  const silhouette = rasters.silhouette ? maskSection(csg, scope, rasters.silhouette) : null;
  const filled = silhouette ? fillHoles(csg, scope, silhouette) : null;
  if (!silhouette || !filled) return emptyOutline(csg, scope);
  const section = state.plate.rounding > 0 ? roundCorners(scope, filled, state.plate.rounding) : filled;
  return { section, warnings: islandWarnings(section), silhouette };
}

/** The plate's outline for any kind, with what it has to say (islands, nothing to crop). */
export function stateOutline(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  rasters: Rasters,
): { section: CrossSection; warnings: Warning[]; silhouette?: CrossSection } {
  if (state.plate.kind === 'crop') return cropOutline(csg, scope, state, rasters);
  if (state.plate.kind === 'vignette' || state.plate.kind === 'svg') return silhouetteOutline(csg, scope, state, rasters);
  return { section: plateOutline(csg, scope, state.plate), warnings: [] };
}

export function outlineRings(section: CrossSection): Ring[] {
  return section.toPolygons().map((polygon) => polygon.map(([x, y]): [number, number] => [x, y]));
}

function cutterSolid(csg: CsgApi, scope: CsgScope, cutter: Cutter): Manifold {
  if (cutter.kind === 'revolve') {
    const profile = scope.keep(new csg.CrossSection([cutter.profile], 'Positive'));
    const radius = Math.max(...cutter.profile.map(([r]) => r));
    const solid = scope.keep(profile.revolve(segmentsFor(radius)));
    return scope.keep(solid.translate([cutter.x, cutter.y, 0]));
  }
  const section = scope.keep(new csg.CrossSection(cutter.rings, 'Positive'));
  const prism = scope.keep(section.extrude(cutter.z1 - cutter.z0));
  return scope.keep(prism.translate([0, 0, cutter.z0]));
}

/** How far under the base's top an image's height 0 lies, mm: the two never share a plane. */
export const IMAGE_EPS = 0.01;

export type Quality = 'preview' | 'export';

/** The grid step of an image (spec §8.4): 0.5 mm for a preview; for an export its pixel size, within 0.1…0.2 mm. */
export function gridStep(image: Pick<ImageElement, 'size' | 'pixelWidth' | 'pixelHeight'>, quality: Quality): number {
  if (quality === 'preview') return 0.5;
  const pixel = image.size / Math.max(image.pixelWidth, image.pixelHeight);
  return Math.max(0.1, Math.min(pixel, 0.2));
}

function meshSolid(csg: CsgApi, scope: CsgScope, mesh: { positions: Float32Array; indices: Uint32Array }, what = 'a relief'): Manifold {
  const input = new csg.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
  const solid = scope.keep(csg.Manifold.ofMesh(input));
  const status = solid.status();
  if (status !== 'NoError') throw new Error(`${what} is not a closed solid (${status})`);
  return solid;
}

/** An image's relief: a heightfield over its rectangle, turned and moved into place. */
function imageSolid(csg: CsgApi, scope: CsgScope, image: ImageElement, raster: Raster, thickness: number, quality: Quality): Manifold {
  const box = elementBox(image);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const field = heightField(raster, image);
  const mesh = heightfieldMesh((x, y) => sampleField(field.values, field.width, field.height, w, h, x, y), {
    width: w,
    height: h,
    step: gridStep(image, quality),
    zero: thickness - IMAGE_EPS,
    bottom: thickness / 2,
    avoid: thickness,
  });
  const solid = meshSolid(csg, scope, mesh);
  const turned = scope.keep(solid.rotate([0, 0, image.rotation]));
  return scope.keep(turned.translate([image.x, image.y, 0]));
}

/** Strokes thinner than this would not print well (spec §10: two nozzle widths), mm. */
export const THIN_STROKE = 0.8;
/** The share of a text's area an opening by half THIN_STROKE may take before `text.thin`. */
const THIN_LOSS = 0.05;

interface TextSection {
  text: TextElement;
  section: CrossSection;
  squeeze: number;
}

/** A text's contours as a cross-section in the plate frame. */
function textSection(csg: CsgApi, scope: CsgScope, text: TextElement, raster: TextRaster): TextSection | null {
  const { rings, squeeze } = textRings(raster, text);
  if (rings.length === 0) return null;
  const local = scope.keep(new csg.CrossSection(rings, 'Positive'));
  const turned = scope.keep(local.rotate(text.rotation));
  return { text, section: scope.keep(turned.translate([text.x, text.y])), squeeze };
}

/** `text.thin` (spec §10): the contour opened by half a thin stroke loses more than 5 % of its area. */
function isThin(scope: CsgScope, section: CrossSection): boolean {
  const area = section.area();
  if (area <= 0) return false;
  const r = THIN_STROKE / 2;
  const shrunk = scope.keep(section.offset(-r, 'Round', 2, segmentsFor(r)));
  const opened = scope.keep(shrunk.offset(r, 'Round', 2, segmentsFor(r)));
  return 1 - opened.area() / area > THIN_LOSS;
}

/** A prism of a cross-section between two heights. */
function prismOf(scope: CsgScope, section: CrossSection, z0: number, z1: number): Manifold {
  const prism = scope.keep(section.extrude(z1 - z0));
  return scope.keep(prism.translate([0, 0, z0]));
}

/** How far a cut reaches into what an earlier cut emptied, so the two never share a wall, mm. */
const CUT_OVERLAP = 0.01;

/**
 * The base with the rim and the frame (spec §2.3, §2.5) standing on it, by
 * construction: the outline extruded to the highest of them, then cut back
 * down to T wherever nothing is raised, and to the lower height where only
 * the lower one is. No two walls are shared: a union of the base with a rim
 * whose outer wall is the base's left slivers on every curve.
 */
function raisedBase(
  csg: CsgApi,
  scope: CsgScope,
  outline: CrossSection,
  prism: (z1: number) => Manifold,
  thickness: number,
  rim: { width: number; height: number } | null,
  frame: { section: CrossSection; height: number } | null,
): Manifold {
  const high = Math.max(rim?.height ?? 0, frame?.height ?? 0);
  const tall = prism(thickness + high);
  if (!rim && !frame) return tall;
  // offsetting arcs leaves vertices closer than a float32 tells apart: simplified
  const inset = rim
    ? scope.keep(scope.keep(outline.offset(-rim.width, 'Round', 2, segmentsFor(rim.width))).simplify(CHORD_TOLERANCE / 10))
    : null;
  // the silhouette's windows: inside its outer contour, not in it
  const filled = frame ? fillHoles(csg, scope, frame.section) : null;
  const windows = frame && filled ? scope.keep(filled.subtract(frame.section)) : null;
  const flat = inset && windows ? scope.keep(inset.intersect(windows)) : (inset ?? windows);
  let base = tall;
  const cut = (region: CrossSection, from: number) => {
    // an empty region's prism is no harmless nothing in manifold: it empties the solid
    if (region.isEmpty()) return;
    base = scope.keep(base.subtract(prismOf(scope, region, from, thickness + high + 1)));
  };
  if (flat) cut(flat, thickness);
  if (rim && frame && inset && windows && rim.height !== frame.height) {
    if (frame.height > rim.height) {
      // the rim's ring where it crosses the windows stops at the rim's height
      cut(scope.keep(windows.subtract(scope.keep(inset.offset(-CUT_OVERLAP, 'Miter')))), thickness + rim.height);
    } else {
      // the frame inside the rim stops at the frame's height
      cut(scope.keep(scope.keep(frame.section.offset(CUT_OVERLAP, 'Miter')).intersect(inset)), thickness + frame.height);
    }
  }
  return base;
}

const reversed = <T>(rings: readonly T[][]): T[][] => rings.map((ring) => ring.toReversed());

interface Terrace {
  inset: number;
  z0: number;
  z1: number;
  /** the shrunk outline, outer rings counter-clockwise */
  rings: [number, number][][];
}

/**
 * A stack of terraces as one mesh, built directly: each slab's walls, the
 * step between two neighbours (the ring between their outlines, up where
 * the upper one is narrower, down where it is wider), the two caps. A
 * union of the slabs' prisms would be the same solid, many times slower.
 */
function terraceSolid(csg: CsgApi, scope: CsgScope, terraces: readonly Terrace[]): Manifold {
  const positions: number[] = [];
  const triangles: number[] = [];
  const ringsAt = (rings: Terrace['rings'], z: number): number[][] =>
    rings.map((ring) =>
      ring.map(([x, y]) => {
        positions.push(x, y, z);
        return positions.length / 3 - 1;
      }),
    );
  // a flat region given by its rings, on the vertices each ring has here; facing up or down
  const face = (rings: Terrace['rings'], ids: number[][], up: boolean) => {
    const flat = ids.flat();
    for (const [a, b, c] of csg.triangulate(rings)) triangles.push(flat[a], up ? flat[b] : flat[c], up ? flat[c] : flat[b]);
  };
  let below: { inset: number; rings: Terrace['rings']; ids: number[][] } | null = null;
  for (const terrace of terraces) {
    const bottom = ringsAt(terrace.rings, terrace.z0);
    const top = ringsAt(terrace.rings, terrace.z1);
    bottom.forEach((ring, r) => {
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        triangles.push(ring[i], ring[j], top[r][j], ring[i], top[r][j], top[r][i]);
      }
    });
    if (!below) face(terrace.rings, bottom, false);
    else if (terrace.inset > below.inset) face([...below.rings, ...reversed(terrace.rings)], [...below.ids, ...reversed(bottom)], true);
    else face([...terrace.rings, ...reversed(below.rings)], [...bottom, ...reversed(below.ids)], false);
    below = { inset: terrace.inset, rings: terrace.rings, ids: top };
  }
  if (below) face(below.rings, below.ids, true);
  return meshSolid(csg, scope, { positions: Float32Array.from(positions), indices: Uint32Array.from(triangles) }, 'the edges’ terraces');
}

/**
 * The outline's prisms from the back face up to a height, with the edges
 * (spec §2.2a) rounded or chamfered: the slabs of `geo/edges.ts` as one
 * terraced mesh. The shrunk outlines are shared by every prism asked for;
 * sharp edges give plain extrusions.
 */
function edgedPrisms(csg: CsgApi, scope: CsgScope, outline: CrossSection, plate: Plate, quality: Quality): (z1: number) => Manifold {
  if (plate.edgeSize <= 0) return (z1) => prismOf(scope, outline, 0, z1);
  const shrunk = new Map<number, Terrace['rings']>();
  const ringsOf = (inset: number): Terrace['rings'] => {
    const known = shrunk.get(inset);
    if (known) return known;
    if (inset === 0) return outline.toPolygons();
    const offset = scope.keep(outline.offset(-inset, 'Round', 2, segmentsFor(inset)));
    const rings = scope.keep(offset.simplify(CHORD_TOLERANCE / 10)).toPolygons();
    shrunk.set(inset, rings);
    return rings;
  };
  return (z1) => {
    // a thin part the inset swallows has no slab there: its stack starts higher, or ends lower
    const terraces = edgeSlabs(plate, EDGE_STEP[quality], z1).flatMap((slab) => {
      const rings = ringsOf(slab.inset);
      return rings.length > 0 ? [{ ...slab, rings }] : [];
    });
    // only an empty outline has no terrace at all
    return terraces.length > 0 ? terraceSolid(csg, scope, terraces) : prismOf(scope, outline, 0, z1);
  };
}

export interface Rasters {
  /** one per `state.images` (null: not decoded) */
  images: readonly (Raster | null)[];
  /** one per `state.texts` (null: not drawn yet) */
  texts: readonly (TextRaster | null)[];
  /** a vignette's or an own SVG's silhouette, drawn by the main thread (null: not drawn yet) */
  silhouette?: TextRaster | null;
}

/**
 * The solid (spec §6):
 *   ( base ∪ images ∪ raised texts ) ∩ outline prism − engraved texts − holes − magnet pockets
 * and the warnings only the contours can tell.
 */
export function buildSolid(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  rasters: Rasters,
  quality: Quality,
): { solid: Manifold; warnings: Warning[] } {
  const { thickness } = state.plate;
  const { section: outline, warnings, silhouette } = stateOutline(csg, scope, state, rasters);
  const { rim, rimWidth, rimHeight, frameHeight } = state.plate;
  const frame = state.plate.frame && silhouette ? silhouette : null;
  if (frame && isThin(scope, frame)) {
    const { min, max } = frame.bounds();
    warnings.push({ code: 'frame.thin', ids: [], spot: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] });
  }
  // the outline's prisms, with the edges rounded or chamfered
  const prism = edgedPrisms(csg, scope, outline, state.plate, quality);
  const base = raisedBase(
    csg,
    scope,
    outline,
    prism,
    thickness,
    rim ? { width: rimWidth, height: rimHeight } : null,
    frame ? { section: frame, height: frameHeight } : null,
  );
  const images = state.images.flatMap((image, i) => {
    const raster = rasters.images[i];
    return image.visible && raster ? [{ image, raster }] : [];
  });
  const texts = state.texts.flatMap((text, i) => {
    const raster = rasters.texts[i];
    const made = text.visible && raster ? textSection(csg, scope, text, raster) : null;
    return made ? [made] : [];
  });
  for (const { text, section, squeeze } of texts) {
    const spot: [number, number] = [text.x, text.y];
    if (isThin(scope, section)) warnings.push({ code: 'text.thin', ids: [text.id], spot });
    if (squeeze < 1) warnings.push({ code: 'text.arcTooLong', ids: [text.id], params: { percent: Math.round(squeeze * 100) }, spot });
  }
  const raised = texts.filter(({ text }) => text.mode === 'raised');
  const engraved = texts.filter(({ text }) => text.mode === 'engraved');

  // the top of everything that stands on the base
  const top =
    thickness +
    Math.max(
      0,
      rim ? rimHeight : 0,
      frame ? frameHeight : 0,
      ...images.map(({ image }) => image.height),
      ...raised.map(({ text }) => text.height),
    );
  let solid = base;
  if (images.length > 0 || raised.length > 0) {
    const reliefs = [
      ...images.map(({ image, raster }) => imageSolid(csg, scope, image, raster, thickness, quality)),
      // from inside the base, so the text is one with whatever is under it
      ...raised.map(({ text, section }) => prismOf(scope, section, thickness / 2, thickness + text.height)),
    ];
    const additive = scope.keep(csg.Manifold.union([base, ...reliefs]));
    // its edges trim whatever reaches them
    solid = scope.keep(additive.intersect(prism(top + 1)));
  }
  const cutters = [
    // from the floor of the engraving up through everything
    ...engraved.map(({ text, section }) => prismOf(scope, section, thickness - text.depth, top + 1)),
    ...state.holes
      .filter((hole) => hole.visible)
      .flatMap((hole) => holeCutters(hole, thickness, top).map((cutter) => cutterSolid(csg, scope, cutter))),
    // placed on the outline as built: the outline job gives the 2D view the same rings
    ...magnetCutters(state.magnets, outlineRings(outline), state.plate.edgeSize).map((cutter) => cutterSolid(csg, scope, cutter)),
  ];
  if (cutters.length > 0) solid = scope.keep(solid.subtract(scope.keep(csg.Manifold.union(cutters))));
  return { solid, warnings };
}

export interface PlateMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export function buildPlate(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  rasters: Rasters,
  quality: Quality,
): { mesh: PlateMesh; warnings: Warning[] } {
  const { solid, warnings } = buildSolid(csg, scope, state, rasters, quality);
  const mesh = solid.getMesh();
  return { mesh: { positions: positionsOf(mesh.vertProperties, mesh.numProp), indices: new Uint32Array(mesh.triVerts) }, warnings };
}

/** The whole solid as a mesh, images only (texts need their rasters too: buildPlate). */
export function buildMesh(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  images: readonly (Raster | null)[] = [],
  quality: Quality = 'preview',
): PlateMesh {
  return buildPlate(csg, scope, state, { images, texts: [] }, quality).mesh;
}

/** The first three properties of each vertex are x, y, z; manifold may carry more. */
function positionsOf(vertProperties: Float32Array, numProp: number): Float32Array {
  if (numProp === 3) return new Float32Array(vertProperties);
  const count = vertProperties.length / numProp;
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    positions[v * 3] = vertProperties[v * numProp];
    positions[v * 3 + 1] = vertProperties[v * numProp + 1];
    positions[v * 3 + 2] = vertProperties[v * numProp + 2];
  }
  return positions;
}
