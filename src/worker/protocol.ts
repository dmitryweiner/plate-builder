// Protocol of the CSG worker. Types only: both sides of the boundary (main
// and worker) must see one description of the messages.
//
// The worker boundary is an outer boundary of the core, like a file or
// localStorage: whatever state comes in is sanitised by the worker itself.

/**
 * A job. `ping` loads the geometry engine and answers; the outline and mesh
 * jobs of spec §8.4 join this union as the milestones bring them.
 */
export type Job = { kind: 'ping' };

export type JobKind = Job['kind'];

/** What a finished job returns, by kind. */
export type JobResult = { kind: 'ping'; volume: number };

/**
 * Progress by stages. Manifold says nothing about itself inside one boolean:
 * the bar counts stages, the label names the current one.
 */
export interface JobProgress {
  step: number;
  total: number;
  label: string;
}

export interface WorkerIn<J = Job> {
  jobId: number;
  job: J;
}

/** A reply; `ms` is the time the worker spent on the job. */
export type WorkerOut<R = JobResult> =
  | ({ type: 'progress'; jobId: number } & JobProgress)
  | { type: 'done'; jobId: number; result: R; ms: number }
  | { type: 'error'; jobId: number; message: string };

/** Checks the envelope only: the result comes from our own worker. */
export function isWorkerOut<R>(data: unknown): data is WorkerOut<R> {
  if (typeof data !== 'object' || data === null) return false;
  if (!('jobId' in data) || typeof data.jobId !== 'number') return false;
  if (!('type' in data)) return false;
  return data.type === 'progress' || data.type === 'done' || data.type === 'error';
}
