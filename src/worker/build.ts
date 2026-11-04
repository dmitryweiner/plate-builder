// The recipe of the solid (spec §6), step by step as the milestones bring
// the parts. Now: the outline with its rounded corners, extruded into the
// base.
//
//   plate = ( base ∪ rim ∪ frame ∪ images ∪ raised texts ) ∩ outline prism
//           − engraved texts − holes

import type { CrossSection } from 'manifold-3d';
import { CHORD_TOLERANCE, primitiveOutline, segmentsFor, type Ring } from '../geo/outline';
import { PRIMITIVE_KINDS, type Plate, type PlateState, type PrimitiveKind } from '../geo/state';
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

/** The whole solid as a mesh. */
export function buildMesh(csg: CsgApi, scope: CsgScope, state: PlateState): PlateMesh {
  const outline = plateOutline(csg, scope, state.plate);
  const base = scope.keep(outline.extrude(state.plate.thickness));
  const mesh = base.getMesh();
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
