import { describe, expect, it } from 'vitest';
import { CsgScope, initCSG } from './csg';
import { runJob } from './jobs';

describe('initCSG', () => {
  it('loads manifold once and builds solids', async () => {
    const csg = await initCSG();
    expect(await initCSG()).toBe(csg);
    const scope = new CsgScope();
    const cube = scope.keep(csg.Manifold.cube([2, 3, 4]));
    expect(cube.volume()).toBeCloseTo(24);
    scope.dispose();
  });
});

describe('CsgScope', () => {
  it('deletes everything it keeps, once', () => {
    const deleted: string[] = [];
    const scope = new CsgScope();
    const a = scope.keep({ delete: () => deleted.push('a') });
    scope.keep({ delete: () => deleted.push('b') });
    expect(scope.size).toBe(2);
    expect(typeof a.delete).toBe('function');
    scope.dispose();
    scope.dispose();
    expect(deleted).toEqual(['a', 'b']);
    expect(scope.size).toBe(0);
  });
});

describe('runJob', () => {
  it('answers a ping after building a test solid', async () => {
    const csg = await initCSG();
    expect(runJob(csg, { kind: 'ping' })).toEqual({ kind: 'ping', volume: 1 });
  });
});
