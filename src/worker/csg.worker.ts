// All the CSG of the app. The main thread sends jobs here and gets plain
// data back: the manifold WASM module never reaches the main thread, and the
// tab does not freeze on a fine export. A thin adapter: the work itself is
// in jobs.ts, tested in Node.

import { initCSG } from './csg';
import { resultTransfer, runJob } from './jobs';
import { isJob, type WorkerIn, type WorkerOut } from './protocol';

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
    // Buffers are transferred, not copied.
    send({ type: 'done', jobId, result, ms: performance.now() - started }, resultTransfer(result));
  } catch (error) {
    send({ type: 'error', jobId, message: error instanceof Error ? error.message : String(error) });
  }
}

function send(message: WorkerOut, transfer: Transferable[] = []): void {
  postMessage(message, { transfer });
}

function isWorkerIn(data: unknown): data is WorkerIn {
  return typeof data === 'object' && data !== null && 'jobId' in data && typeof data.jobId === 'number' && 'job' in data && isJob(data.job);
}
