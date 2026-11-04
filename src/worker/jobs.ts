// What the worker does with each job, without the messaging: testable in
// Node with the real manifold module.

import { encodeSTL } from '../geo/stl';
import { meshNormals } from '../geo/mesh';
import { sanitizeState } from '../geo/state';
import { meshProblems, validateMesh } from '../geo/validate';
import { buildMesh, outlineRings, plateOutline } from './build';
import { CsgScope, type CsgApi } from './csg';
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
    if (job.kind === 'outline') return { kind: 'outline', rings: outlineRings(plateOutline(csg, scope, state.plate)) };
    const { positions, indices } = buildMesh(csg, scope, state);
    const report = validateMesh({ positions, indices, normals: meshNormals(positions, indices) });
    const problems = meshProblems(report);
    const stl = job.quality === 'export' && problems.length === 0 ? encodeSTL({ positions, indices }, { name: state.name }) : null;
    return { kind: 'mesh', quality: job.quality, positions, indices, report, problems, stl };
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
