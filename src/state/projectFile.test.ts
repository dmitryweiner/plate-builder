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

  it('opens a file from before the magnets with none', () => {
    const old: Record<string, unknown> = { ...state() };
    delete old.magnets;
    const read = readProjectFile(JSON.stringify({ app: 'plate-builder', version: STATE_VERSION, state: old }));
    expect(read).toEqual({ ok: true, state: state() });
    expect(read.ok && read.state.magnets.count).toBe(0);
  });

  it('opens a file from before the edges with sharp ones', () => {
    const plate: Record<string, unknown> = { ...state().plate };
    delete plate.edgeSize;
    delete plate.edgeProfile;
    const read = readProjectFile(JSON.stringify({ app: 'plate-builder', version: STATE_VERSION, state: { ...state(), plate } }));
    expect(read).toEqual({ ok: true, state: state() });
    expect(read.ok && [read.state.plate.edgeSize, read.state.plate.edgeProfile]).toEqual([0, 'fillet']);
  });

  it('round-trips the edges', () => {
    const plate = { ...state().plate, edgeSize: 1.2, edgeProfile: 'chamfer' as const };
    const read = readProjectFile(projectFileText({ ...state(), plate }));
    expect(read.ok && read.state.plate).toEqual(plate);
  });

  it('round-trips magnets', () => {
    const magnets = { ...state().magnets, count: 3, layout: 'triangleDown' as const, diameter: 8 };
    const read = readProjectFile(projectFileText({ ...state(), magnets }));
    expect(read.ok && read.state.magnets).toEqual(magnets);
  });

  it('sanitises what it reads', () => {
    const text = JSON.stringify({ app: 'plate-builder', version: STATE_VERSION, state: { plate: { thickness: -5 } } });
    const read = readProjectFile(text);
    expect(read.ok && read.state.plate.thickness).toBe(0.6);
  });
});
