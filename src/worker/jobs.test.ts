import { describe, expect, it } from 'vitest';
import { initCSG } from 'maker-kit/csg/manifold';
import type { Raster } from '../geo/heightmap';
import { defaultImage, defaultState } from '../geo/state';
import { resultTransfer, runJob } from './jobs';

describe('runJob', () => {
  it('answers a ping after building a test solid', async () => {
    const csg = await initCSG();
    expect(runJob(csg, { kind: 'ping' })).toEqual({ kind: 'ping', volume: 1 });
  });

  it('sanitises the state it gets: the worker boundary is an outer one', async () => {
    const csg = await initCSG();
    const result = runJob(csg, { kind: 'outline', state: JSON.parse('{"plate":{"width":1e9,"height":"x","rounding":0}}') });
    if (result.kind !== 'outline') throw new Error(result.kind);
    const xs = result.rings.flat().map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(300);
  });

  it('builds a preview mesh without a file and an export with the STL', async () => {
    const csg = await initCSG();
    const state = defaultState();
    const preview = runJob(csg, { kind: 'mesh', quality: 'preview', state });
    if (preview.kind !== 'mesh') throw new Error(preview.kind);
    expect(preview.stl).toBeNull();
    expect(preview.problems).toEqual([]);
    expect(preview.report.watertight).toBe(true);
    const exported = runJob(csg, { kind: 'mesh', quality: 'export', state });
    if (exported.kind !== 'mesh') throw new Error(exported.kind);
    expect(exported.stl?.byteLength).toBe(84 + 50 * exported.report.triangleCount);
  });

  it('builds the images whose rasters come with the job and ignores broken ones', async () => {
    const csg = await initCSG();
    const base = defaultState();
    const image = { ...defaultImage(base, 'data:image/png;base64,x', 2, 2), height: 2 };
    const state = { ...base, images: [image, image] };
    const raster = { width: 2, height: 2, data: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]) };
    const top = (rasters: unknown) => {
      const result = runJob(csg, { kind: 'mesh', quality: 'preview', state, rasters: rasters as (Raster | null)[] });
      return result.kind === 'mesh' ? result.report.bbox.max[2] : 0;
    };
    expect(top([raster, null])).toBeCloseTo(5, 1);
    expect(top([{ width: 3, height: 2, data: raster.data }, 'x'])).toBeCloseTo(3, 4);
  });
});

describe('resultTransfer', () => {
  it('moves the mesh and file buffers instead of copying them', async () => {
    const csg = await initCSG();
    const result = runJob(csg, { kind: 'mesh', quality: 'export', state: defaultState() });
    if (result.kind !== 'mesh') throw new Error(result.kind);
    expect(resultTransfer(result)).toEqual([result.positions.buffer, result.indices.buffer, result.stl]);
    expect(resultTransfer({ kind: 'ping', volume: 1 })).toEqual([]);
  });
});
