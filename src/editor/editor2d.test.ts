// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { primitiveOutline } from '../geo/outline';
import { defaultHole, defaultState, type HoleElement, type PlateState } from '../geo/state';
import { createEditor, type EditorHandle } from './editor2d';
import { toScreen } from './view';

let state: PlateState;
let selected: string | null;
let changes: { state: PlateState; final: boolean }[];
let snapping: boolean;
let editor: EditorHandle;
let canvas: HTMLCanvasElement;

const outline = [primitiveOutline({ ...defaultState().plate, kind: 'rectangle', width: 100, height: 60 })];

function holeAt(over: Partial<HoleElement>): HoleElement {
  return { ...defaultHole('round'), id: 'h1', diameter: 10, ...over };
}

function pointer(type: string, [x, y]: readonly [number, number], over: PointerEventInit = {}) {
  canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', bubbles: true, ...over }));
}

/** A press, moves in steps and a release, all in plate millimetres. */
function drag(from: readonly [number, number], to: readonly [number, number], over: PointerEventInit = {}) {
  const v = editor.view();
  const a = toScreen(v, from);
  const b = toScreen(v, to);
  pointer('pointerdown', a, over);
  for (const t of [0.25, 0.5, 0.75, 1]) pointer('pointermove', [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], over);
  pointer('pointerup', b, over);
}

beforeEach(() => {
  // jsdom has no canvas drawing: the editor draws nothing and handles pointers all the same
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 300 }));
  document.body.append(canvas);
  state = { ...defaultState(), holes: [holeAt({})] };
  selected = null;
  changes = [];
  snapping = false;
  editor = createEditor({
    canvas,
    read: () => state,
    selected: () => selected,
    select: (id) => {
      selected = id;
    },
    change: (next, final) => {
      state = next;
      changes.push({ state: next, final });
    },
    outline: () => outline,
    snapping: () => snapping,
    sizeLabel: () => '100 × 60 mm',
    picture: () => null,
    textShape: () => null,
  });
  editor.fit();
});

afterEach(() => {
  editor.dispose();
  canvas.remove();
  vi.restoreAllMocks();
});

const hole = () => state.holes[0];

describe('2D editor', () => {
  it('fits the plate with a margin, its centre in the middle', () => {
    const v = editor.view();
    expect(v.scale).toBeCloseTo((400 - 48) / 100);
    expect(toScreen(v, [0, 0])).toEqual([200, 150]);
  });

  it('selects with a tap and changes nothing', () => {
    drag([0, 0], [0, 0]);
    expect(selected).toBe('h1');
    expect(changes).toEqual([]);
  });

  it('moves an element with a drag: live frames, then one final change', () => {
    drag([0, 0], [10, -5]);
    expect(selected).toBe('h1');
    expect(hole()?.x).toBeCloseTo(10);
    expect(hole()?.y).toBeCloseTo(-5);
    expect(changes.filter((c) => c.final)).toHaveLength(1);
    expect(changes.at(-1)?.final).toBe(true);
    expect(changes.length).toBeGreaterThan(2);
  });

  it('snaps the centre to the plate axes, unless Alt is held', () => {
    snapping = true;
    state = { ...state, holes: [holeAt({ x: 20, y: 20 })] };
    drag([20, 20], [20.5, 10.3]);
    expect(hole()?.x).toBeCloseTo(20.5);
    expect(hole()?.y).toBeCloseTo(10.3);
    drag([20.5, 10.3], [0.8, 10.3]);
    expect(hole()?.x).toBe(0);
    drag([0, 10.3], [1.5, 10.3], { altKey: true });
    expect(hole()?.x).toBeCloseTo(1.5);
  });

  it('pans the view by dragging empty space and deselects with a tap there', () => {
    selected = 'h1';
    const before = editor.view();
    drag([40, 25], [30, 25]);
    expect(editor.view().cx).toBeCloseTo(before.cx - 10 * before.scale);
    expect(selected).toBe('h1');
    drag([40, 25], [40, 25]);
    expect(selected).toBeNull();
    expect(changes).toEqual([]);
  });

  it('scales the selected element by a corner handle, the opposite corner staying', () => {
    selected = 'h1';
    // corner 2 is the top right (5, 5); the opposite (−5, −5) stays
    drag([5, 5], [10, 10]);
    expect(hole()?.diameter).toBeCloseTo(15);
    expect(hole()?.x).toBeCloseTo(2.5);
    expect(hole()?.y).toBeCloseTo(2.5);
    expect(changes.at(-1)?.final).toBe(true);
  });

  it('moves a small selected element pressed inside, though a touch handle reaches there', () => {
    state = { ...state, holes: [holeAt({ diameter: 4 })] };
    selected = 'h1';
    const touch = { pointerType: 'touch' };
    drag([0.5, 0.5], [10.5, 0.5], touch);
    expect(hole()?.diameter).toBe(4);
    expect(hole()?.x).toBeCloseTo(10);
  });

  it('turns the selected element by its rotation handle, by 15° steps with Shift', () => {
    selected = 'h1';
    const v = editor.view();
    // the handle is 28 px above the top edge's middle
    const handle = toScreen(v, [0, 5]);
    handle[1] -= 28;
    const target = toScreen(v, [-20, 2]);
    pointer('pointerdown', handle);
    pointer('pointermove', target, { shiftKey: true });
    pointer('pointerup', target, { shiftKey: true });
    // the bearing of (−20, 2) is ~174°: 84° from up, 90° in steps of 15
    expect(hole()?.rotation).toBe(90);
  });

  it('scales and turns the element under two fingers', () => {
    const v = editor.view();
    const touch = { pointerType: 'touch' };
    pointer('pointerdown', toScreen(v, [-2, 0]), { ...touch, pointerId: 1 });
    pointer('pointerdown', toScreen(v, [2, 0]), { ...touch, pointerId: 2 });
    pointer('pointermove', toScreen(v, [0, -4]), { ...touch, pointerId: 1 });
    pointer('pointermove', toScreen(v, [0, 4]), { ...touch, pointerId: 2 });
    pointer('pointerup', toScreen(v, [0, -4]), { ...touch, pointerId: 1 });
    pointer('pointerup', toScreen(v, [0, 4]), { ...touch, pointerId: 2 });
    expect(hole()?.diameter).toBeCloseTo(20);
    expect(hole()?.rotation).toBeCloseTo(90);
    expect(changes.filter((c) => c.final)).toHaveLength(1);
  });

  it('zooms the view with two fingers on empty space and with the wheel', () => {
    const v = editor.view();
    const touch = { pointerType: 'touch' };
    pointer('pointerdown', toScreen(v, [30, 20]), { ...touch, pointerId: 1 });
    pointer('pointerdown', toScreen(v, [40, 20]), { ...touch, pointerId: 2 });
    pointer('pointermove', toScreen(v, [50, 20]), { ...touch, pointerId: 2 });
    pointer('pointerup', toScreen(v, [50, 20]), { ...touch, pointerId: 2 });
    pointer('pointerup', toScreen(v, [30, 20]), { ...touch, pointerId: 1 });
    expect(editor.view().scale).toBeCloseTo(v.scale * 2);
    expect(changes).toEqual([]);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 200, clientY: 150 }));
    expect(editor.view().scale).toBeGreaterThan(v.scale * 2);
  });

  it('frames a spot', () => {
    editor.frame([30, -10]);
    expect(toScreen(editor.view(), [30, -10])).toEqual([200, 150]);
  });
});
