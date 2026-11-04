// The warnings that need no CSG (spec §10), computed on the main thread from
// the state and the outline the 2D view shows. Each names its elements and
// carries a spot for the 2D view to frame.

import { boxCorners } from './boxes';
import { holeFootprint, keyholeMinThickness, placeRing } from './holes';
import type { Point, Ring } from './outline';
import type { HoleElement, PlateState } from './state';

export type WarningCode =
  | 'element.outside'
  | 'element.overlap'
  | 'hole.nearEdge'
  | 'keyhole.thin'
  | 'text.arcLines'
  | 'text.buried'
  | 'relief.tall'
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

/** Even-odd: inside the outer ring and not inside a hole. */
export function pointInRings([x, y]: Readonly<Point>, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function pointSegmentDistance([px, py]: Readonly<Point>, [ax, ay]: Readonly<Point>, [bx, by]: Readonly<Point>): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The smallest distance from a vertex of `a` to an edge of `b`. */
function oneWay(a: Ring, b: readonly Ring[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const ring of b) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, pointSegmentDistance(p, ring[j], ring[i]));
    }
  }
  return best;
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

export function warnings(state: PlateState, outline: readonly Ring[]): Warning[] {
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
  for (const text of texts) {
    const box = boxCorners(text);
    const spot: Point = [text.x, text.y];
    if (text.arc && text.text.includes('\n')) out.push({ code: 'text.arcLines', ids: [text.id], spot });
    if (text.mode === 'raised' && images.some((image) => image.height > text.height && ringsOverlap(box, boxCorners(image)))) {
      out.push({ code: 'text.buried', ids: [text.id], spot });
    }
    for (const hole of holes) {
      if (ringsOverlap(footprints.get(hole) ?? [], box))
        out.push({ code: 'element.overlap', ids: [hole.id, text.id], spot: [(hole.x + text.x) / 2, (hole.y + text.y) / 2] });
    }
  }
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
