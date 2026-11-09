import { describe, expect, it } from 'vitest';
import { defaultState } from '../geo/state';
import { csgPolicy } from './client';

// The client itself is maker-kit's WorkerClient, tested there; the app's part is its policy.

describe('csgPolicy', () => {
  it('keeps an export and gives each job kind its lane', () => {
    const state = defaultState();
    expect(csgPolicy.kept({ kind: 'mesh', quality: 'export', state })).toBe(true);
    expect(csgPolicy.kept({ kind: 'mesh', quality: 'preview', state })).toBe(false);
    expect(csgPolicy.lane({ kind: 'outline', state })).not.toBe(csgPolicy.lane({ kind: 'mesh', quality: 'preview', state }));
  });
});
