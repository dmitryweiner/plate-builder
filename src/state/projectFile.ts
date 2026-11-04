// The project file (spec §11): `*.plate.json`, the state with its version
// and the app's name, so a file from elsewhere is refused with a reason
// rather than half-read.

import { fileSlug } from '../geo/stl';
import { sanitizeState, STATE_VERSION, type PlateState } from '../geo/state';

const APP = 'plate-builder';

export type ReadProject = { ok: true; state: PlateState } | { ok: false; reason: 'broken' | 'foreign' | 'newer' };

export function projectFileText(state: PlateState): string {
  return JSON.stringify({ app: APP, version: STATE_VERSION, state }, null, 1);
}

export const projectFileName = (name: string): string => `${fileSlug(name)}.plate.json`;

export function readProjectFile(text: string): ReadProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'broken' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !('app' in data) || data.app !== APP)
    return { ok: false, reason: 'foreign' };
  if (!('version' in data) || typeof data.version !== 'number') return { ok: false, reason: 'broken' };
  if (data.version > STATE_VERSION) return { ok: false, reason: 'newer' };
  if (!('state' in data) || typeof data.state !== 'object' || data.state === null) return { ok: false, reason: 'broken' };
  return { ok: true, state: sanitizeState(data.state) };
}
