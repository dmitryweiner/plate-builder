// The warnings that need no CSG (spec §10), computed on the main thread from
// the state and the outline the 2D view shows. Each names its elements and
// carries a spot for the 2D view to frame.

import { boxCorners } from './boxes';
import { circle, holeFootprint, keyholeMinThickness, placeRing } from './holes';
import { magnetMinThickness, magnetPocket, magnetPositions } from './magnets';
import { distanceToRings, pointInRings, type Point, type Ring } from './outline';
import { ENGRAVE_FLOOR, type HoleElement, type PlateState, type TextElement } from './state';

export type WarningCode =
  | 'element.outside'
  | 'element.overlap'
  | 'hole.nearEdge'
  | 'keyhole.thin'
  | 'text.arcLines'
  | 'text.buried'
  | 'text.onEdge'
  | 'relief.tall'
  | 'magnet.thin'
  | 'magnet.noRoom'
  | 'magnet.overlap'
  // the last build's mesh check failed: export is blocked
  | 'mesh.invalid'
  // found by the worker, which has the contours
  | 'outline.islands'
  | 'outline.empty'
  | 'text.thin'
  | 'frame.thin'
  | 'text.arcTooLong';

export interface Warning {
  code: WarningCode;
  params?: Readonly<Record<string, number>>;
  /** the elements it is about */
  ids: string[];
  /** where to look, plate frame */
  spot: Point;
}

/** A relief taller than this many times the base warps it as it cools (spec §10). */
export const TALL_RELIEF = 3;

/** Material a hole needs around it, mm (two nozzle widths and a half). */
export const HOLE_EDGE_MIN = 2;

/** Material between two magnets' pockets, mm. */
export const MAGNET_GAP = 1;

/** The smallest distance from a vertex of `a` to an edge of `b`. */
function oneWay(a: Ring, b: readonly Ring[]): number {
  return Math.min(...a.map((p) => distanceToRings(p, b)));
}

/** The gap between a ring and a set of rings (0 when edges touch); exact for polygons that do not cross. */
export function ringsDistance(a: Ring, b: readonly Ring[]): number {
  return Math.min(oneWay(a, b), ...b.map((ring) => oneWay(ring, [a])));
}

const orient = (p: Readonly<Point>, q: Readonly<Point>, r: Readonly<Point>) =>
  Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));

function segmentsCross(a: Readonly<Point>, b: Readonly<Point>, c: Readonly<Point>, d: Readonly<Point>): boolean {
  return orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);
}

/** Whether two simple polygons share any area: crossing edges, or one inside the other. */
export function ringsOverlap(a: Ring, b: Ring): boolean {
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) if (segmentsCross(a[j], a[i], b[l], b[k])) return true;
  }
  return pointInRings(a[0], [b]) || pointInRings(b[0], [a]);
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Whether a ring shares area with a shape of several rings (even-odd: a letter's counter is no ink). */
function overlapsShape(ring: Ring, shape: readonly Ring[]): boolean {
  for (const other of shape) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      for (let k = 0, l = other.length - 1; k < other.length; l = k++) if (segmentsCross(ring[j], ring[i], other[l], other[k])) return true;
    }
  }
  return pointInRings(ring[0], shape) || shape.some((other) => other.length > 0 && pointInRings(other[0], [ring]));
}

/**
 * The warnings of the state on this outline. `textInk`: texts' contours in
 * their own frames, where they are known (the main thread traces them); a
 * text without them is taken by its box.
 */
export function warnings(
  state: PlateState,
  outline: readonly Ring[],
  textInk: ReadonlyMap<string, readonly Ring[]> = new Map(),
): Warning[] {
  const out: Warning[] = [];
  const holes = state.holes.filter((hole) => hole.visible);
  const footprints = new Map<HoleElement, Ring>(holes.map((hole) => [hole, placeRing(hole, holeFootprint(hole))]));

  for (const hole of holes) {
    const footprint = footprints.get(hole) ?? [];
    const spot: Point = [hole.x, hole.y];
    if (!footprint.every((p) => pointInRings(p, outline))) {
      out.push({ code: 'element.outside', ids: [hole.id], spot });
    } else {
      const gap = ringsDistance(footprint, outline);
      if (gap < HOLE_EDGE_MIN) out.push({ code: 'hole.nearEdge', ids: [hole.id], params: { distance: round1(gap) }, spot });
    }
    if (hole.kind === 'keyhole') {
      const needed = keyholeMinThickness(hole);
      if (state.plate.thickness < needed) out.push({ code: 'keyhole.thin', ids: [hole.id], params: { needed }, spot });
    }
  }

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const [a, b] = [holes[i], holes[j]];
      if (ringsOverlap(footprints.get(a) ?? [], footprints.get(b) ?? []))
        out.push({ code: 'element.overlap', ids: [a.id, b.id], spot: [(a.x + b.x) / 2, (a.y + b.y) / 2] });
    }
  }

  const images = state.images.filter((image) => image.visible);
  const texts = state.texts.filter((text) => text.visible);
  // a crop follows its images and texts: their boxes (a picture's transparent corners) may stick out of it
  const boxed = state.plate.kind === 'crop' ? [] : [...images, ...texts];
  for (const e of boxed) {
    if (!boxCorners(e).every((p) => pointInRings(p, outline))) out.push({ code: 'element.outside', ids: [e.id], spot: [e.x, e.y] });
  }
  const inks = new Map<TextElement, Ring[] | undefined>();
  for (const text of texts) {
    const box = boxCorners(text);
    const spot: Point = [text.x, text.y];
    if (text.arc && text.text.includes('\n')) out.push({ code: 'text.arcLines', ids: [text.id], spot });
    if (text.mode === 'raised' && images.some((image) => image.height > text.height && ringsOverlap(box, boxCorners(image)))) {
      out.push({ code: 'text.buried', ids: [text.id], spot });
    }
    const ink = textInk.get(text.id)?.map((r) => placeRing(text, r));
    inks.set(text, ink);
    // the rounded or chamfered edges reach edgeSize in from the outline: a text there loses its own edge
    const { edgeSize } = state.plate;
    if (edgeSize > 0 && pointInRings(spot, outline) && Math.min(...(ink ?? [box]).map((ring) => ringsDistance(ring, outline))) < edgeSize) {
      out.push({ code: 'text.onEdge', ids: [text.id], spot });
    }
    for (const hole of holes) {
      const footprint = footprints.get(hole) ?? [];
      if (ink ? overlapsShape(footprint, ink) : ringsOverlap(footprint, box)) {
        out.push({ code: 'element.overlap', ids: [hole.id, text.id], spot: [(hole.x + text.x) / 2, (hole.y + text.y) / 2] });
      }
    }
  }
  out.push(...magnetWarnings(state, outline, holes, footprints, inks));
  const { plate } = state;
  const relief = Math.max(
    0,
    ...images.map((image) => image.height),
    ...texts.filter((text) => text.mode === 'raised').map((text) => text.height),
    plate.rim ? plate.rimHeight : 0,
    (plate.kind === 'vignette' || plate.kind === 'svg') && plate.frame ? plate.frameHeight : 0,
  );
  if (relief > TALL_RELIEF * plate.thickness + 1e-9)
    out.push({ code: 'relief.tall', ids: [], params: { times: Math.round((relief / plate.thickness) * 10) / 10 }, spot: [0, 0] });
  return out;
}

/** magnet.thin, magnet.noRoom, magnet.overlap: each once, at the first magnet it is about. */
function magnetWarnings(
  state: PlateState,
  outline: readonly Ring[],
  holes: readonly HoleElement[],
  footprints: ReadonlyMap<HoleElement, Ring>,
  inks: ReadonlyMap<TextElement, Ring[] | undefined>,
): Warning[] {
  const { magnets, plate } = state;
  const spots = magnetPositions(magnets, outline, plate.edgeSize);
  if (spots.length === 0) return [];
  const out: Warning[] = [];
  const { radius, depth } = magnetPocket(magnets);
  const needed = magnetMinThickness(magnets);
  if (plate.thickness < needed) out.push({ code: 'magnet.thin', ids: [], params: { needed }, spot: [spots[0].x, spots[0].y] });
  const crowded = spots.find(
    (a, i) => !a.fits || spots.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < 2 * radius + MAGNET_GAP),
  );
  if (crowded) out.push({ code: 'magnet.noRoom', ids: [], spot: [crowded.x, crowded.y] });
  const pockets = spots.map(({ x, y }) => circle(x, y, radius));
  for (const hole of holes) {
    const footprint = footprints.get(hole) ?? [];
    const at = pockets.findIndex((pocket) => ringsOverlap(pocket, footprint));
    if (at >= 0) out.push({ code: 'magnet.overlap', ids: [hole.id], spot: [spots[at].x, spots[at].y] });
  }
  // an engraving's floor too close to a pocket's ceiling: a micron of slack for 3 − 0.5 − 2.1
  for (const [text, ink] of inks) {
    if (text.mode !== 'engraved' || plate.thickness - text.depth - depth >= ENGRAVE_FLOOR - 1e-9) continue;
    const box = boxCorners(text);
    const at = pockets.findIndex((pocket) => (ink ? overlapsShape(pocket, ink) : ringsOverlap(pocket, box)));
    if (at >= 0) out.push({ code: 'magnet.overlap', ids: [text.id], spot: [spots[at].x, spots[at].y] });
  }
  return out;
}
