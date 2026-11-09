// Main-thread side of the CSG worker: maker-kit's WorkerClient (one worker,
// created lazily, one waiting job per lane; a replaced job resolves to
// null) with the app's policy: one lane per job kind, an export kept.

import { moduleWorker, WorkerClient, type JobPolicy, type WorkerFactory } from 'maker-kit/worker/client';
import type { Job, JobResult } from './protocol';

export type { JobDone } from 'maker-kit/worker/client';

/** The app's CSG worker; Vite bundles it by this `new Worker(new URL(…))` in the app's own code. */
export const csgWorker: WorkerFactory<Job> = moduleWorker(
  () => new Worker(new URL('./csg.worker.ts', import.meta.url), { type: 'module' }),
);

/** How the app's jobs share the queue: one lane per kind; an export is kept. */
export const csgPolicy: JobPolicy<Job> = { lane: (job) => job.kind, kept: (job) => job.kind === 'mesh' && job.quality === 'export' };

export function csgClient(factory: WorkerFactory<Job> = csgWorker): WorkerClient<Job, JobResult> {
  return new WorkerClient(factory, csgPolicy);
}
