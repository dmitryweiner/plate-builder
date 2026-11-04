// All the CSG of the app. The main thread sends jobs here and gets plain
// data back: the manifold WASM module never reaches the main thread, and the
// tab does not freeze on a fine export. A thin adapter: the work itself is
// in jobs.ts, tested in Node.

import { initCSG } from './csg';
import { runJob } from './jobs';
import type { Job, WorkerIn, WorkerOut } from './protocol';

/** WASM starts loading as soon as the worker exists: the client creates it lazily, when there is work. */
const ready = initCSG();

addEventListener('message', (event: MessageEvent<unknown>) => {
  if (isWorkerIn(event.data)) void handle(event.data);
});

async function handle({ jobId, job }: WorkerIn): Promise<void> {
  // From the job's arrival, so the first job's time includes loading WASM.
  const started = performance.now();
  try {
    const csg = await ready;
    const result = runJob(csg, job);
    send({ type: 'done', jobId, result, ms: performance.now() - started });
  } catch (error) {
    send({ type: 'error', jobId, message: error instanceof Error ? error.message : String(error) });
  }
}

function send(message: WorkerOut): void {
  postMessage(message);
}

function isJob(job: unknown): job is Job {
  return typeof job === 'object' && job !== null && 'kind' in job && job.kind === 'ping';
}

function isWorkerIn(data: unknown): data is WorkerIn {
  return typeof data === 'object' && data !== null && 'jobId' in data && typeof data.jobId === 'number' && 'job' in data && isJob(data.job);
}
