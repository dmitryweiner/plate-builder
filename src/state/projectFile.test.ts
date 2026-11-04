import { describe, expect, it } from 'vitest';
import { defaultHole, defaultState, sanitizeState, STATE_VERSION } from '../geo/state';
import { projectFileName, projectFileText, readProjectFile } from './projectFile';

const state = () => sanitizeState({ ...defaultState(), name: 'Door sign', holes: [defaultHole('slot')] });

describe('project file', () => {
  it('round-trips a project', () => {
    expect(readProjectFile(projectFileText(state()))).toEqual({ ok: true, state: state() });
  });

  it('is named after the project', () => {
    expect(projectFileName('Door sign')).toBe('door-sign.plate.json');
    expect(projectFileName('')).toBe('plate.plate.json');
  });

  it('refuses what is not JSON, another app’s file and a newer version', () => {
    expect(readProjectFile('{nope')).toEqual({ ok: false, reason: 'broken' });
    expect(readProjectFile('[]')).toEqual({ ok: false, reason: 'foreign' });
    expect(readProjectFile(JSON.stringify({ app: 'case-constructor', version: 1, state: {} }))).toEqual({ ok: false, reason: 'foreign' });
    expect(readProjectFile(JSON.stringify({ app: 'plate-builder', version: STATE_VERSION + 1, state: {} }))).toEqual({
      ok: false,
      reason: 'newer',
    });
    expect(readProjectFile(JSON.stringify({ app: 'plate-builder', version: STATE_VERSION }))).toEqual({ ok: false, reason: 'broken' });
  });

  it('sanitises what it reads', () => {
    const text = JSON.stringify({ app: 'plate-builder', version: STATE_VERSION, state: { plate: { thickness: -5 } } });
    const read = readProjectFile(text);
    expect(read.ok && read.state.plate.thickness).toBe(0.6);
  });
});
