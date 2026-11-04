// Bridge to manifold-3d (WASM CSG). Manifold objects are not
// garbage-collected — everything created must be deleted explicitly, hence
// CsgScope.
//
// Worker only: the main thread never imports this file (CLAUDE.md; CI greps
// the main chunk for "manifold").

import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

/** Everything we need from the WASM module: primitive constructors and Mesh. */
export type CsgApi = ManifoldToplevel;

let pending: Promise<CsgApi> | null = null;

/** Loads WASM once per process / worker; later calls return the same promise. */
export function initCSG(): Promise<CsgApi> {
  pending ??= Module().then((wasm) => {
    wasm.setup();
    return wasm;
  });
  return pending;
}

/**
 * Holds Manifold / CrossSection objects and frees them at once. Any chain of
 * booleans breeds intermediates; without a scope the WASM heap grows until it
 * runs out after a few exports.
 */
export class CsgScope {
  private items: { delete(): void }[] = [];

  /** Registers an object for deletion and returns it (handy in expressions). */
  keep<T extends { delete(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }

  get size(): number {
    return this.items.length;
  }

  dispose(): void {
    for (const item of this.items) item.delete();
    this.items = [];
  }
}
