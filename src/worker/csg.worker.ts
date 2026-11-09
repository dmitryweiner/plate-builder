// All the CSG of the app. The main thread sends jobs here and gets plain
// data back: the manifold WASM module never reaches the main thread, and the
// tab does not freeze on a fine export. A thin adapter over maker-kit's
// serveJobs: the work itself is in jobs.ts, tested in Node.

import { serveJobs } from 'maker-kit/worker/serve';
import { initCSG } from './csg';
import { resultTransfer, runJob } from './jobs';
import { isJob, type Job, type JobResult } from './protocol';

/** WASM starts loading as soon as the worker exists: the client creates it lazily, when there is work. */
const ready = initCSG();

serveJobs<Job, JobResult>({
  isJob,
  async handle(job) {
    // the time counts from the job's arrival, so the first one's includes loading WASM
    const result = runJob(await ready, job);
    return { result, transfer: resultTransfer(result) };
  },
});
