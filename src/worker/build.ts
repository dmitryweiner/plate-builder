// The recipe of the solid (spec §6), step by step as the milestones bring
// the parts. Now: the outline with its rounded corners, extruded into the
// base.
//
//   plate = ( base ∪ rim ∪ frame ∪ images ∪ raised texts ) ∩ outline prism
//           − engraved texts − holes

import type { CrossSection, Manifold } from 'manifold-3d';
import { elementBox } from '../editor/elements';
import { heightfieldMesh } from '../geo/grid';
import { heightField, sampleField, type Raster } from '../geo/heightmap';
import { holeCutters, type Cutter } from '../geo/holes';
import { CHORD_TOLERANCE, primitiveOutline, segmentsFor, type Ring } from '../geo/outline';
import { PRIMITIVE_KINDS, type ImageElement, type Plate, type PlateState, type PrimitiveKind } from '../geo/state';
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

export function outlineRings(section: CrossSection): Ring[] {
  return section.toPolygons().map((polygon) => polygon.map(([x, y]): [number, number] => [x, y]));
}

export interface PlateMesh {
  positions: Float32Array;
  indices: Uint32Array;
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

function meshSolid(csg: CsgApi, scope: CsgScope, mesh: { positions: Float32Array; indices: Uint32Array }): Manifold {
  const input = new csg.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
  const solid = scope.keep(csg.Manifold.ofMesh(input));
  const status = solid.status();
  if (status !== 'NoError') throw new Error(`a relief is not a closed solid (${status})`);
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

/**
 * The solid (spec §6):
 *   ( base ∪ images ) ∩ outline prism − holes
 * `rasters` go with `state.images`, one each (null: not decoded).
 */
export function buildSolid(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  rasters: readonly (Raster | null)[] = [],
  quality: Quality = 'preview',
): Manifold {
  const { thickness } = state.plate;
  const outline = plateOutline(csg, scope, state.plate);
  const base = scope.keep(outline.extrude(thickness));
  const images = state.images.flatMap((image, i) => {
    const raster = rasters[i];
    return image.visible && raster ? [{ image, raster }] : [];
  });
  // the top of everything that stands on the base
  const top = thickness + Math.max(0, ...images.map(({ image }) => image.height));
  let solid = base;
  if (images.length > 0) {
    const reliefs = images.map(({ image, raster }) => imageSolid(csg, scope, image, raster, thickness, quality));
    const additive = scope.keep(csg.Manifold.union([base, ...reliefs]));
    const prism = scope.keep(outline.extrude(top + 1));
    solid = scope.keep(additive.intersect(prism));
  }
  const cutters = state.holes.filter((hole) => hole.visible).flatMap((hole) => holeCutters(hole, thickness, top));
  if (cutters.length === 0) return solid;
  const holes = scope.keep(csg.Manifold.union(cutters.map((cutter) => cutterSolid(csg, scope, cutter))));
  return scope.keep(solid.subtract(holes));
}

/** The whole solid as a mesh. */
export function buildMesh(
  csg: CsgApi,
  scope: CsgScope,
  state: PlateState,
  rasters: readonly (Raster | null)[] = [],
  quality: Quality = 'preview',
): PlateMesh {
  const mesh = buildSolid(csg, scope, state, rasters, quality).getMesh();
  return { positions: positionsOf(mesh.vertProperties, mesh.numProp), indices: new Uint32Array(mesh.triVerts) };
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
