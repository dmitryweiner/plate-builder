// What the worker does with each job, without the messaging: testable in
// Node with the real manifold module.

import { meshNormals } from 'maker-kit/3d/mesh';
import { encodeSTL } from 'maker-kit/3d/stl';
import { assessExport, validateMesh } from 'maker-kit/3d/validate';
import { isRaster } from '../geo/heightmap';
import { sanitizeState } from '../geo/state';
import { isTextRaster } from '../geo/textShape';
import { buildPlate, outlineRings, stateOutline } from './build';
import { CsgScope, type CsgApi } from 'maker-kit/csg/manifold';
import type { Job, JobResult } from './protocol';

export function runJob(csg: CsgApi, job: Job): JobResult {
  const scope = new CsgScope();
  try {
    if (job.kind === 'ping') {
      // A unit cube proves the module does not only load but also computes.
      return { kind: 'ping', volume: scope.keep(csg.Manifold.cube([1, 1, 1])).volume() };
    }
    // The worker boundary is an outer boundary, like a file or the UI.
    const state = sanitizeState(job.state);
    // rasters are checked by their shape only, one per element (spec §8.3)
    const rasters = {
      images: state.images.map((_, i) => {
        const raster = job.rasters?.[i];
        return isRaster(raster) ? raster : null;
      }),
      texts: state.texts.map((_, i) => {
        const raster = job.textRasters?.[i];
        return isTextRaster(raster) ? raster : null;
      }),
      silhouette: isTextRaster(job.silhouette) ? job.silhouette : null,
    };
    if (job.kind === 'outline') {
      const { section, warnings } = stateOutline(csg, scope, state, rasters);
      return { kind: 'outline', rings: outlineRings(section), warnings };
    }
    const { mesh, warnings } = buildPlate(csg, scope, state, rasters, job.quality);
    const { positions, indices } = mesh;
    const report = validateMesh({ positions, indices, normals: meshNormals(positions, indices) });
    // the kit's export gate: a plate is a solid to print, so it must be closed
    const problems = assessExport(report, true).blockers;
    const stl =
      job.quality === 'export' && problems.length === 0
        ? encodeSTL({ positions, indices }, { brand: 'Plate Builder', name: state.name })
        : null;
    return { kind: 'mesh', quality: job.quality, positions, indices, report, problems, stl, warnings };
  } finally {
    scope.dispose();
  }
}

/** Buffers of a result that move to the main thread instead of being copied. */
export function resultTransfer(result: JobResult): ArrayBuffer[] {
  if (result.kind !== 'mesh') return [];
  const buffers: ArrayBuffer[] = [];
  for (const buffer of [result.positions.buffer, result.indices.buffer, result.stl])
    if (buffer instanceof ArrayBuffer) buffers.push(buffer);
  return buffers;
}
