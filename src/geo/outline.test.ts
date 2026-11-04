import { describe, expect, it } from 'vitest';
import { bounds, primitiveOutline, ringArea, segmentsFor, type Ring } from './outline';
import { defaultPlate, PRIMITIVE_KINDS, type Plate, type PrimitiveKind } from './state';

type PrimitivePlate = Plate & { kind: PrimitiveKind };

const plate = (kind: PrimitiveKind, over: Partial<Plate> = {}): PrimitivePlate => ({
  ...defaultPlate(),
  width: 80,
  height: 50,
  ...over,
  kind,
});

/** Area of the unit shape over its own box, so the expected area scales to any width × height. */
function boxShare(points: readonly (readonly [number, number])[], unitArea: number): number {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return unitArea / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)));
}

function regular(n: number, radius: number, phase: number): [number, number][] {
  return Array.from({ length: n }, (_, k) => [
    radius * Math.cos(phase + (2 * Math.PI * k) / n),
    radius * Math.sin(phase + (2 * Math.PI * k) / n),
  ]);
}

/** The classic heart curve, sampled densely: its box for the expected area. */
const heartCurve = Array.from({ length: 20000 }, (_, i): [number, number] => {
  const t = (2 * Math.PI * i) / 20000;
  return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
});

/** Expected area by formula, for a given plate. */
function expectedArea(p: PrimitivePlate): number {
  const { width: w, height: h } = p;
  const formulas: Record<PrimitiveKind, () => number> = {
    rectangle: () => w * h,
    ellipse: () => (Math.PI * w * h) / 4,
    triangle: () => (w * h) / 2,
    polygon: () => w * h * boxShare(regular(p.sides, 1, Math.PI / 2), (p.sides / 2) * Math.sin((2 * Math.PI) / p.sides)),
    star: () => {
      const n = p.points;
      const tips = [...regular(n, 1, Math.PI / 2), ...regular(n, p.innerRatio, Math.PI / 2 + Math.PI / n)];
      return w * h * boxShare(tips, n * p.innerRatio * Math.sin(Math.PI / n));
    },
    // ∮ x dy of the classic curve is 180π
    heart: () => w * h * boxShare(heartCurve, 180 * Math.PI),
    // straight sides over the top 40 %, then x = w/2·cos(uπ/2) down to the point
    shield: () => w * h * (0.4 + 1.2 / Math.PI),
    tag: () => w * h - (Math.min(h / 2, w / 2) * h) / 2,
  };
  return formulas[p.kind]();
}

/** The x of the points on the top edge of a 50 mm high ring. */
const topXs = (ring: Ring) => ring.filter((q) => q[1] > 25 - 1e-9).map((q) => q[0]);

describe('segmentsFor', () => {
  it('keeps the chord error within tolerance and is a multiple of four', () => {
    for (const r of [5, 50, 150]) {
      const n = segmentsFor(r);
      expect(n % 4).toBe(0);
      expect(r * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(0.01);
    }
    expect(segmentsFor(0.01)).toBe(8);
    expect(segmentsFor(1e9)).toBe(1024);
  });
});

describe('primitiveOutline', () => {
  const cases: PrimitivePlate[] = [
    ...PRIMITIVE_KINDS.map((kind) => plate(kind)),
    ...PRIMITIVE_KINDS.map((kind) => plate(kind, { width: 10, height: 300 })),
    plate('polygon', { sides: 5 }),
    plate('polygon', { sides: 12 }),
    plate('star', { points: 4, innerRatio: 0.2 }),
    plate('star', { points: 12, innerRatio: 0.9 }),
    plate('ellipse', { width: 60, height: 60 }),
  ];

  it.each(cases.map((p) => [`${p.kind} ${p.width}×${p.height} (${p.sides}, ${p.points}, ${p.innerRatio})`, p] as const))(
    '%s: exact box, centred, counter-clockwise, area by formula',
    (_, p) => {
      const ring: Ring = primitiveOutline(p);
      const box = bounds([ring]);
      expect(box.minX).toBeCloseTo(-p.width / 2, 9);
      expect(box.maxX).toBeCloseTo(p.width / 2, 9);
      expect(box.minY).toBeCloseTo(-p.height / 2, 9);
      expect(box.maxY).toBeCloseTo(p.height / 2, 9);
      const area = ringArea(ring);
      expect(area).toBeGreaterThan(0);
      expect(Math.abs(area / expectedArea(p) - 1)).toBeLessThan(2e-3);
    },
  );

  it('has no repeated neighbours (zero-length edges)', () => {
    for (const p of cases) {
      const ring = primitiveOutline(p);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1e-6);
      }
    }
  });

  it('keeps the shapes upright: triangle and polygon apex up, heart notch up, tag point at the start', () => {
    for (const ring of [primitiveOutline(plate('triangle')), primitiveOutline(plate('polygon', { sides: 5 }))]) {
      expect(topXs(ring)).toHaveLength(1);
      expect(topXs(ring)[0]).toBeCloseTo(0, 9);
    }
    const tag = primitiveOutline(plate('tag'));
    expect(tag.filter((q) => q[0] < -40 + 1e-9)).toEqual([[-40, 0]]);
    const heart = primitiveOutline(plate('heart'));
    const bottom = heart.reduce((low, q) => (q[1] < low[1] ? q : low));
    expect(bottom[0]).toBeCloseTo(0, 6);
  });
});
