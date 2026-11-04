import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes committed steps', () => {
    const h = new History({ n: 0 });
    h.commit({ n: 1 });
    h.commit({ n: 2 });
    expect(h.undo()).toEqual({ n: 1 });
    expect(h.undo()).toEqual({ n: 0 });
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual({ n: 1 });
    expect(h.state).toEqual({ n: 1 });
  });

  it('makes a gesture one step: live frames, then the commit', () => {
    const h = new History({ x: 0 });
    for (const x of [1, 2, 3]) h.live({ x });
    expect(h.state).toEqual({ x: 3 });
    expect(h.canUndo).toBe(false);
    h.commit({ x: 4 });
    expect(h.undo()).toEqual({ x: 0 });
    expect(h.redo()).toEqual({ x: 4 });
  });

  it('ignores a commit that changes nothing', () => {
    const h = new History({ x: 0 });
    h.live({ x: 1 });
    h.commit({ x: 0 });
    expect(h.canUndo).toBe(false);
    h.commit({ x: 0 });
    expect(h.canUndo).toBe(false);
  });

  it('drops the redo branch on a new step', () => {
    const h = new History(0);
    h.commit(1);
    h.undo();
    h.commit(2);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(0);
  });

  it('undo in the middle of a gesture cancels the gesture', () => {
    const h = new History(0);
    h.commit(1);
    h.live(5);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(1);
  });

  it('keeps at most `limit` steps', () => {
    const h = new History(0, 3);
    for (let n = 1; n <= 10; n++) h.commit(n);
    let undone = 0;
    while (h.undo() !== null) undone++;
    expect(undone).toBe(3);
    expect(h.state).toBe(7);
  });

  it('replaces everything on reset', () => {
    const h = new History(0);
    h.commit(1);
    h.reset(9);
    expect([h.state, h.canUndo, h.canRedo]).toEqual([9, false, false]);
  });
});
