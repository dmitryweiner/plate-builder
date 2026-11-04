import { describe, expect, it } from 'vitest';
import { defaultHole, defaultImage, defaultState, type HoleElement } from '../geo/state';
import { boxCorners, elementBox, hitTest, scaleElement } from './elements';
import { moveElement, pinchElement, rotateTowards, scaleFromCorner, snapPoint, snapTargets } from './gestures';
import { toPlate } from './view';

const hole = (over: Partial<HoleElement> = {}): HoleElement => ({ ...defaultHole('round'), id: 'h1', ...over });
const image = () => ({ ...defaultImage(defaultState(), 'data:image/png;base64,', 200, 100), id: 'i1', size: 40 });

describe('moveElement', () => {
  it('moves by a screen drag converted through a zoomed view, whatever the element turn', () => {
    const view = { scale: 4, cx: 200, cy: 150 };
    const [x0, y0] = toPlate(view, [100, 100]);
    const [x1, y1] = toPlate(view, [140, 60]);
    const moved = moveElement(hole({ x: 3, y: 4, rotation: 37 }), x1 - x0, y1 - y0);
    expect([moved.x, moved.y]).toEqual([13, 14]);
    expect(moved.rotation).toBe(37);
  });
});

describe('scaleFromCorner', () => {
  it('keeps the opposite corner where it was', () => {
    const start = { ...image(), x: 5, y: -3, rotation: 30 };
    const before = boxCorners(start);
    for (const corner of [0, 1, 2, 3]) {
      const dragged = before[corner];
      // drag the corner 1.5× as far from the opposite one
      const opposite = before[(corner + 2) % 4];
      const pointer: [number, number] = [opposite[0] + 1.5 * (dragged[0] - opposite[0]), opposite[1] + 1.5 * (dragged[1] - opposite[1])];
      const scaled = scaleFromCorner(start, corner, pointer);
      expect(scaled.size).toBeCloseTo(60);
      const after = boxCorners(scaled);
      expect(after[(corner + 2) % 4][0]).toBeCloseTo(opposite[0], 9);
      expect(after[(corner + 2) % 4][1]).toBeCloseTo(opposite[1], 9);
      expect(after[corner][0]).toBeCloseTo(pointer[0], 9);
    }
  });

  it('scales by the reach along the diagonal, ignoring sideways motion', () => {
    const start = hole({ diameter: 10 });
    // corner 2 is (5, 5); the opposite (−5, −5); a point off the diagonal projects onto it
    expect(scaleFromCorner(start, 2, [15, 5]).diameter).toBeCloseTo(15);
  });

  it('stops at the size limits and keeps the opposite corner even then', () => {
    const start = hole({ diameter: 40 });
    const scaled = scaleFromCorner(start, 2, [1000, 1000]);
    expect(scaled.diameter).toBe(50);
    expect(boxCorners(scaled)[0][0]).toBeCloseTo(-20);
    expect(scaleFromCorner(start, 2, [-1000, -1000]).diameter).toBe(1);
  });
});

describe('scaleElement', () => {
  it('scales a hole kind’s sizes together and keeps their proportions at a limit', () => {
    const { element, factor } = scaleElement({ ...defaultHole('countersunk'), id: 'h1' }, 3);
    expect(factor).toBeCloseTo(8 / 4.5);
    expect(element.screw).toBeCloseTo(8);
    expect(element.head / element.screw).toBeCloseTo(8.5 / 4.5);
  });
});

describe('rotateTowards', () => {
  it('turns the element so that its top faces the pointer', () => {
    expect(rotateTowards(hole({ x: 10, y: 10 }), [10, 20]).rotation).toBeCloseTo(0);
    expect(rotateTowards(hole({ x: 10, y: 10 }), [0, 10]).rotation).toBeCloseTo(90);
    expect(rotateTowards(hole({ x: 10, y: 10 }), [20, 10]).rotation).toBeCloseTo(270);
  });

  it('snaps to steps with Shift', () => {
    const p: [number, number] = [Math.cos((100 * Math.PI) / 180), Math.sin((100 * Math.PI) / 180)];
    expect(rotateTowards(hole(), p).rotation).toBeCloseTo(10);
    expect(rotateTowards(hole(), p, 15).rotation).toBe(15);
  });
});

describe('pinchElement', () => {
  it('scales, turns and moves with two fingers', () => {
    const start = hole({ diameter: 10, x: 0, y: 0, rotation: 10 });
    const pinched = pinchElement(start, [-5, 0], [5, 0], [0, -10], [0, 10]);
    expect(pinched.diameter).toBeCloseTo(20);
    expect(pinched.rotation).toBeCloseTo(100);
    expect([pinched.x, pinched.y]).toEqual([0, 0]);
    const moved = pinchElement(start, [-5, 0], [5, 0], [-2, 3], [8, 3]);
    expect([moved.x, moved.y, moved.diameter]).toEqual([3, 3, 10]);
  });
});

describe('snapPoint', () => {
  it('snaps each axis to the nearest line within the threshold', () => {
    const targets = { xs: [0, 20], ys: [0, 7] };
    expect(snapPoint([0.9, 6.2], targets, 1)).toEqual({ point: [0, 7], guides: { x: 0, y: 7 } });
    expect(snapPoint([1.1, 3], targets, 1)).toEqual({ point: [1.1, 3], guides: { x: null, y: null } });
  });

  it('a threshold of 6 screen px is 1.5 mm at 4 px/mm and 0.5 mm at 12', () => {
    expect(snapPoint([1.4, 9], { xs: [0], ys: [] }, 6 / 4).guides.x).toBe(0);
    expect(snapPoint([1.4, 9], { xs: [0], ys: [] }, 6 / 12).guides.x).toBeNull();
  });

  it('takes the plate axes and the other visible elements', () => {
    const elements = [hole({ id: 'h1', x: 5, y: 6 }), hole({ id: 'h2', x: 7, y: 8 }), hole({ id: 'h3', x: 9, y: 9, visible: false })];
    expect(snapTargets(elements, 'h1')).toEqual({ xs: [0, 7], ys: [0, 8] });
  });
});

describe('hitTest', () => {
  it('finds the topmost element by its shape and ignores hidden ones', () => {
    const state = {
      ...defaultState(),
      images: [{ ...image(), x: 0 }],
      holes: [hole({ x: 0, diameter: 10 }), { ...hole({ x: 30 }), id: 'h2', visible: false }],
    };
    expect(hitTest(state, [0, 0])?.id).toBe('h1');
    // inside the hole's box, outside its circle: the image under it
    expect(hitTest(state, [4.5, 4.5])?.id).toBe('i1');
    expect(hitTest(state, [30, 0])).toBeNull();
    expect(hitTest(state, [100, 100])).toBeNull();
  });

  it('turns with the element', () => {
    const slot = { ...defaultHole('slot'), id: 'h1', length: 20, width: 4 };
    expect(hitTest({ ...defaultState(), holes: [slot] }, [0, 8])).toBeNull();
    expect(hitTest({ ...defaultState(), holes: [{ ...slot, rotation: 90 }] }, [0, 8])?.id).toBe('h1');
    expect(elementBox(slot)).toEqual({ minX: -10, maxX: 10, minY: -2, maxY: 2 });
  });
});
