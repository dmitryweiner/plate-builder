import { describe, expect, it } from 'vitest';
import { EDGE_JITTER, EDGE_MIN_GAP, EDGE_STEP, edgeInset, edgeLevels, edgeSlabs } from './edges';
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

describe('edgeSlabs', () => {
  it('has none for a sharp plate', () => {
    expect(edgeSlabs(plate({ edgeSize: 0 }), EDGE_STEP.export, 5)).toEqual([]);
  });

  it('stacks the bottom edge, the wall and the top edge, from the back face up to the given height', () => {
    const p = plate({ thickness: 3, edgeSize: 1.5 });
    const n = edgeLevels(1.5, 'fillet', EDGE_STEP.preview).length;
    const slabs = edgeSlabs(p, EDGE_STEP.preview, 5.5);
    expect(slabs).toHaveLength(2 * n - 1);
    expect(slabs[0].z0).toBe(0);
    expect(slabs.at(-1)?.z1).toBe(5.5);
    // the widest is the wall's, in the middle; the top edge mirrors the bottom one about the wall's middle
    for (let k = 0; k < n - 1; k++) {
      expect(slabs[k].inset).toBeGreaterThan(slabs[k + 1].inset);
      expect(slabs[2 * n - 2 - k].inset).toBe(slabs[k].inset);
    }
    for (let k = 1; k < n; k++) expect(slabs[k].z0 + slabs[2 * n - 2 - k].z1).toBeCloseTo(3, 12);
  });

  it.each(['fillet', 'chamfer'] as const)('%s: each slab ends where the next begins; neighbours’ insets a gap apart', (edgeProfile) => {
    const slabs = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5, edgeProfile }), EDGE_STEP.export, 3);
    for (let k = 0; k + 1 < slabs.length; k++) {
      expect(slabs[k].z1).toBe(slabs[k + 1].z0);
      expect(slabs[k].z1).toBeGreaterThan(slabs[k].z0);
      expect(Math.abs(slabs[k].inset - slabs[k + 1].inset)).toBeGreaterThanOrEqual(EDGE_MIN_GAP - 1e-12);
    }
  });

  it('merges a fillet’s terraces near the wall, where their insets differ by microns', () => {
    const slabs = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5 }), EDGE_STEP.export, 3);
    expect(slabs.length).toBeLessThan(2 * edgeLevels(1.5, 'fillet', EDGE_STEP.export).length - 1);
    // the profile still ends at r from each face: the wall's slab starts within the last terraces
    const middle = slabs[(slabs.length - 1) / 2];
    expect(middle.z0).toBeLessThan(1.5);
    expect(middle.z0).toBeGreaterThan(1);
  });

  it('stands on the rim’s top when there is a rim', () => {
    const slabs = edgeSlabs(plate({ thickness: 3, rim: true, rimHeight: 1, edgeSize: 1 }), EDGE_STEP.preview, 4);
    const middle = slabs[(slabs.length - 1) / 2];
    expect(middle.z0 + middle.z1).toBeCloseTo(4, 12);
  });

  it('keeps its levels off the plate’s own planes', () => {
    // a 1 mm chamfer has slabs of 1/15 mm; one of them would end exactly on T under a 0.2 mm rim
    const p = plate({ thickness: 3, rim: true, rimHeight: 0.2, edgeSize: 1, edgeProfile: 'chamfer' });
    const slabs = edgeSlabs(p, EDGE_STEP.export, 3.2);
    expect(slabs).toHaveLength(29);
    for (const { z0, z1 } of slabs) for (const z of [z0, z1]) expect(Math.abs(z - 3)).toBeGreaterThan(EDGE_JITTER / 2);
  });
});
