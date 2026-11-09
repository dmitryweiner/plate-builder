// The project file (spec §11): `*.plate.json`, the kit's wrapper
// `{ app, version, name, savedAt, state }` around the state, so a file from
// elsewhere is refused with a reason rather than half-read.

import { decodeProjectFile, encodeProjectFile, projectFileName as kitFileName, type DecodedProjectFile } from 'maker-kit/core/projectFile';
import { sanitizeState, STATE_VERSION, type PlateState } from '../geo/state';

const APP = 'plate-builder';

export type ReadProject = DecodedProjectFile<PlateState>;

export function projectFileText(state: PlateState, savedAt?: Date): string {
  return encodeProjectFile({ app: APP, version: STATE_VERSION, name: state.name, state, savedAt });
}

export const projectFileName = (name: string): string => kitFileName(name, 'plate.json', 'plate');

export function readProjectFile(text: string): ReadProject {
  return decodeProjectFile(text, { app: APP, version: STATE_VERSION, sanitize: sanitizeState });
}
