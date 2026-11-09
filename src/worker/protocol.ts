// The CSG worker's jobs and results; the envelope around them (ids,
// progress, errors) is maker-kit's worker/protocol. Both sides of the
// boundary see one description of the messages.
//
// The worker boundary is an outer boundary of the core, like a file or
// localStorage: whatever state comes in is sanitised by the worker itself.

import type { Raster } from '../geo/heightmap';
import type { Ring } from '../geo/outline';
import type { PlateState } from '../geo/state';
import type { TextRaster } from '../geo/textShape';
import type { Warning } from '../geo/warnings';
import type { MeshReport } from 'maker-kit/3d/validate';
import type { Message } from 'maker-kit/core/message';
import type { KitKey } from 'maker-kit/i18n/index';

/**
 * A job (spec §8.4). `ping` loads the geometry engine and answers;
 * `outline` returns the plate's outline for the 2D view; `mesh` builds the
 * solid, at preview or export quality (an export also returns the STL).
 */
export type Job =
  | { kind: 'ping' }
  | {
      kind: 'outline';
      state: PlateState;
      rasters?: (Raster | null)[];
      textRasters?: (TextRaster | null)[];
      /** a vignette's or own SVG's silhouette, drawn by the main thread at the plate's size */
      silhouette?: TextRaster | null;
    }
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
      /** the texts drawn by the main thread with their fonts, one per `state.texts` (null: the font is not in yet) */
      textRasters?: (TextRaster | null)[];
      silhouette?: TextRaster | null;
    };

export type JobKind = Job['kind'];

export interface MeshResult {
  kind: 'mesh';
  quality: 'preview' | 'export';
  positions: Float32Array;
  indices: Uint32Array;
  report: MeshReport;
  /** what blocks the export (the kit's export gate, `kit.mesh.*`); empty when the mesh is fine */
  problems: Message<KitKey>[];
  /** the binary STL of an export; null for a preview */
  stl: ArrayBuffer | null;
  /** what only the contours can tell (text.thin, text.arcTooLong) */
  warnings: Warning[];
}

/** What a finished job returns, by kind. */
/** An outline: its rings (plate frame) and what it has to say (islands, nothing to crop). */
export type JobResult = { kind: 'ping'; volume: number } | { kind: 'outline'; rings: Ring[]; warnings: Warning[] } | MeshResult;

/** Checks a job's shape; its state is sanitised by the worker anyway. */
export function isJob(job: unknown): job is Job {
  if (typeof job !== 'object' || job === null || !('kind' in job)) return false;
  if (job.kind === 'ping') return true;
  if (!('state' in job)) return false;
  if (job.kind === 'outline') return true;
  return job.kind === 'mesh' && 'quality' in job && (job.quality === 'preview' || job.quality === 'export');
}
