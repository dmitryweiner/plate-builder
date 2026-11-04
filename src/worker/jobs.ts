// What the worker does with each job, without the messaging: testable in
// Node with the real manifold module.

import { CsgScope, type CsgApi } from './csg';
import type { Job, JobResult } from './protocol';

export function runJob(csg: CsgApi, job: Job): JobResult {
  const scope = new CsgScope();
  try {
    // A unit cube proves the module does not only load but also computes.
    const volume = scope.keep(csg.Manifold.cube([1, 1, 1])).volume();
    return { kind: job.kind, volume };
  } finally {
    scope.dispose();
  }
}
