import { describe, expect, it } from 'vitest';
import { CUT_OVERSHOOT } from './holes';
import { EDGE_JITTER, EDGE_STEP, edgeCores, edgeInset, edgeLevels } from './edges';
import { defaultPlate, type Plate } from './state';

const plate = (over: Partial<Plate>): Plate => ({ ...defaultPlate(), ...over });

describe('edgeInset', () => {
  it('follows a quarter circle for a fillet', () => {
    expect(edgeInset(2, 'fillet', 0)).toBeCloseTo(2, 12);
    expect(edgeInset(2, 'fillet', 2)).toBeCloseTo(0, 12);
    const t = 2 * (1 - Math.cos(Math.PI / 4));
    expect(edgeInset(2, 'fillet', t)).toBeCloseTo(2 * (1 - Math.sin(Math.PI / 4)), 12);
  });

  it('follows a 45° line for a chamfer', () => {
    expect(edgeInset(2, 'chamfer', 0)).toBe(2);
    expect(edgeInset(2, 'chamfer', 0.5)).toBe(1.5);
    expect(edgeInset(2, 'chamfer', 2)).toBe(0);
  });

  it('is 0 beyond the edge and r at its face or past it', () => {
    expect(edgeInset(2, 'fillet', 3)).toBe(0);
    expect(edgeInset(2, 'chamfer', -1)).toBe(2);
  });
});

describe('edgeLevels', () => {
  it('has none for a sharp edge', () => {
    expect(edgeLevels(0, 'fillet', EDGE_STEP.export)).toEqual([]);
  });

  it.each([
    [1.5, 'fillet', 'preview', 5],
    [1.5, 'fillet', 'export', 24],
    [1.5, 'chamfer', 'preview', 5],
    [1.5, 'chamfer', 'export', 22],
    [0.2, 'fillet', 'preview', 4],
    [10, 'fillet', 'export', 48],
  ] as const)('%s mm %s, %s: %i levels', (size, profile, quality, count) => {
    expect(edgeLevels(size, profile, EDGE_STEP[quality])).toHaveLength(count);
  });

  it.each(['fillet', 'chamfer'] as const)('%s: slabs up to the edge’s end, each at the profile’s middle', (profile) => {
    const r = 2;
    const levels = edgeLevels(r, profile, EDGE_STEP.export);
    expect(levels.at(-1)?.t).toBeCloseTo(r, 12);
    let below = 0;
    let wider = r;
    for (const { t, inset } of levels) {
      expect(t).toBeGreaterThan(below);
      expect(inset).toBeLessThan(wider);
      expect(inset).toBeGreaterThan(0);
      // the slab's inset is the profile's between its own two heights
      expect(inset).toBeLessThan(edgeInset(r, profile, below));
      expect(inset).toBeGreaterThan(edgeInset(r, profile, t));
      below = t;
      wider = inset;
    }
  });

  it('samples a fillet uniformly in angle: its middle on the circle', () => {
    const r = 2;
    const levels = edgeLevels(r, 'fillet', EDGE_STEP.preview);
    const n = levels.length;
    levels.forEach(({ t, inset }, k) => {
      expect(t).toBeCloseTo(r * (1 - Math.cos(((k + 1) / n) * (Math.PI / 2))), 12);
      const mid = ((k + 0.5) / n) * (Math.PI / 2);
      expect(inset).toBeCloseTo(r * (1 - Math.sin(mid)), 12);
    });
  });
});

describe('edgeCores', () => {
  it('has none for a sharp plate', () => {
    expect(edgeCores(plate({ edgeSize: 0 }), EDGE_STEP.export, 5)).toEqual([]);
  });

  it('nests: the first from below the back to above the top, the others narrower in height, wider in plan', () => {
    const p = plate({ thickness: 3, edgeSize: 1.5 });
    const top = 4.5;
    const cores = edgeCores(p, EDGE_STEP.preview, top);
    expect(cores).toHaveLength(edgeLevels(1.5, 'fillet', EDGE_STEP.preview).length);
    expect(cores[0].z0).toBe(-CUT_OVERSHOOT);
    expect(cores[0].z1).toBe(top + 1);
    for (let k = 1; k < cores.length; k++) {
      const { z0, z1, inset } = cores[k];
      // symmetric about the wall's middle: the bottom edge mirrors the top one
      expect(z0 + z1).toBeCloseTo(3, 12);
      expect(z0).toBeGreaterThan(cores[k - 1].z0);
      expect(z1).toBeLessThan(cores[k - 1].z1);
      expect(inset).toBeLessThan(cores[k - 1].inset);
      expect(z1 - z0).toBeGreaterThan(0);
    }
  });

  it('stands on the rim’s top when there is a rim', () => {
    const cores = edgeCores(plate({ thickness: 3, rim: true, rimHeight: 1, edgeSize: 1 }), EDGE_STEP.preview, 4);
    for (const { z0, z1 } of cores.slice(1)) expect(z0 + z1).toBeCloseTo(4, 12);
  });

  it('keeps its levels off the plate’s own planes', () => {
    // a 1 mm chamfer has slabs of 1/15 mm; one of them would end exactly on T under a 0.2 mm rim
    const p = plate({ thickness: 3, rim: true, rimHeight: 0.2, edgeSize: 1, edgeProfile: 'chamfer' });
    const cores = edgeCores(p, EDGE_STEP.export, 3.2);
    expect(cores).toHaveLength(15);
    for (const { z0, z1 } of cores) for (const z of [z0, z1]) expect(Math.abs(z - 3)).toBeGreaterThan(EDGE_JITTER / 2);
  });
});
