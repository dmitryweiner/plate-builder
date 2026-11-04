// Protocol of the CSG worker. Types only: both sides of the boundary (main
// and worker) must see one description of the messages.
//
// The worker boundary is an outer boundary of the core, like a file or
// localStorage: whatever state comes in is sanitised by the worker itself.

import type { Raster } from '../geo/heightmap';
import type { Ring } from '../geo/outline';
import type { PlateState } from '../geo/state';
import type { MeshProblem, MeshReport } from '../geo/validate';

/**
 * A job (spec §8.4). `ping` loads the geometry engine and answers;
 * `outline` returns the plate's outline for the 2D view; `mesh` builds the
 * solid, at preview or export quality (an export also returns the STL).
 */
export type Job =
  | { kind: 'ping' }
  | { kind: 'outline'; state: PlateState }
  | {
      kind: 'mesh';
      quality: 'preview' | 'export';
      state: PlateState;
      /**
       * The images' pictures, one per `state.images` (null: not decoded yet).
       * Decoding needs the DOM, so the main thread does it; a raster is
       * derived from the state, not part of it, and the worker checks only
       * its shape.
       */
      rasters?: (Raster | null)[];
    };

export type JobKind = Job['kind'];

export interface MeshResult {
  kind: 'mesh';
  quality: 'preview' | 'export';
  positions: Float32Array;
  indices: Uint32Array;
  report: MeshReport;
  /** what blocks the export; empty when the mesh is fine */
  problems: MeshProblem[];
  /** the binary STL of an export; null for a preview */
  stl: ArrayBuffer | null;
}

/** What a finished job returns, by kind. */
export type JobResult = { kind: 'ping'; volume: number } | { kind: 'outline'; rings: Ring[] } | MeshResult;

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

/** Checks a job's shape; its state is sanitised by the worker anyway. */
export function isJob(job: unknown): job is Job {
  if (typeof job !== 'object' || job === null || !('kind' in job)) return false;
  if (job.kind === 'ping') return true;
  if (!('state' in job)) return false;
  if (job.kind === 'outline') return true;
  return job.kind === 'mesh' && 'quality' in job && (job.quality === 'preview' || job.quality === 'export');
}
