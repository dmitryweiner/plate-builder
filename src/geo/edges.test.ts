import { describe, expect, it } from 'vitest';
import { EDGE_JITTER, EDGE_MIN_GAP, EDGE_STEP, edgeInset, edgeLevels, edgeOn, edgeSlabs } from './edges';
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

describe('edgeOn', () => {
  it('is the size on a rounded face, 0 on a sharp one', () => {
    expect([edgeOn(plate({ edgeSize: 1 }), 'top'), edgeOn(plate({ edgeSize: 1 }), 'bottom')]).toEqual([1, 1]);
    expect([edgeOn(plate({ edgeSize: 1, edgeSides: 'top' }), 'top'), edgeOn(plate({ edgeSize: 1, edgeSides: 'top' }), 'bottom')]).toEqual([
      1, 0,
    ]);
    expect([
      edgeOn(plate({ edgeSize: 1, edgeSides: 'bottom' }), 'top'),
      edgeOn(plate({ edgeSize: 1, edgeSides: 'bottom' }), 'bottom'),
    ]).toEqual([0, 1]);
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
    // the last of the five terraces (inset 0.02) is the wall's
    expect(slabs).toHaveLength(2 * n - 1);
    expect(slabs[0].z0).toBe(0);
    expect(slabs.at(-1)?.z1).toBe(5.5);
    // the widest is the wall's, in the middle; the top edge mirrors the bottom one about the wall's middle
    for (let k = 0; k < n - 1; k++) {
      expect(slabs[k].inset).toBeGreaterThan(slabs[k + 1].inset);
      expect(slabs[2 * n - 2 - k].inset).toBe(slabs[k].inset);
    }
    for (let k = 1; k < n; k++) expect(slabs[k].z0 + slabs[2 * n - 2 - k].z1).toBeCloseTo(3, 12);
    // the wall is the outline itself: the plate keeps its size
    expect(slabs[n - 1].inset).toBe(0);
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

  it('at the largest size the edges meet: no wall between them, the last terraces one slab', () => {
    const slabs = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5, edgeProfile: 'chamfer' }), EDGE_STEP.export, 3);
    const middle = slabs[(slabs.length - 1) / 2];
    expect(slabs).toHaveLength(2 * 22 - 1);
    expect(middle.inset).toBeGreaterThan(0);
    expect(middle.z0 + middle.z1).toBeCloseTo(3, 12);
    expect(middle.z1 - middle.z0).toBeGreaterThan(0);
    const lower = edgeSlabs(plate({ thickness: 3, edgeSize: 1.4, edgeProfile: 'chamfer' }), EDGE_STEP.export, 3);
    expect(lower[(lower.length - 1) / 2].inset).toBe(0);
  });

  it('stands on the rim’s top when there is a rim', () => {
    const slabs = edgeSlabs(plate({ thickness: 3, rim: true, rimHeight: 1, edgeSize: 1 }), EDGE_STEP.preview, 4);
    const middle = slabs[(slabs.length - 1) / 2];
    expect(middle.z0 + middle.z1).toBeCloseTo(4, 12);
  });

  it('stacks only the top edge on a wall from the back face, or only the bottom edge under a wall to the top', () => {
    const both = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5 }), EDGE_STEP.preview, 5.5);
    const n = (both.length + 1) / 2;
    const top = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5, edgeSides: 'top' }), EDGE_STEP.preview, 5.5);
    expect(top).toEqual([{ ...both[n - 1], z0: 0 }, ...both.slice(n)]);
    const bottom = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5, edgeSides: 'bottom' }), EDGE_STEP.preview, 5.5);
    expect(bottom).toEqual([...both.slice(0, n - 1), { ...both[n - 1], z1: 5.5 }]);
    // the back face, or the top, is the outline itself
    expect(top[0].inset).toBe(0);
    expect(bottom.at(-1)?.inset).toBe(0);
  });

  it('one edge at the largest size never meets the other face', () => {
    const slabs = edgeSlabs(plate({ thickness: 3, edgeSize: 1.5, edgeProfile: 'chamfer', edgeSides: 'top' }), EDGE_STEP.export, 3);
    expect(slabs).toHaveLength(23);
    expect(slabs[0]).toMatchObject({ inset: 0, z0: 0 });
    expect(slabs[0].z1).toBeCloseTo(1.5, 2);
  });

  it('keeps its levels off the plate’s own planes', () => {
    // a 1 mm chamfer has slabs of 1/15 mm; one of them would end exactly on T under a 0.2 mm rim
    const p = plate({ thickness: 3, rim: true, rimHeight: 0.2, edgeSize: 1, edgeProfile: 'chamfer' });
    const slabs = edgeSlabs(p, EDGE_STEP.export, 3.2);
    expect(slabs).toHaveLength(31);
    for (const { z0, z1 } of slabs) for (const z of [z0, z1]) expect(Math.abs(z - 3)).toBeGreaterThan(EDGE_JITTER / 2);
  });
});
