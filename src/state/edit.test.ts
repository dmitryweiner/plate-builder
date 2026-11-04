import { describe, expect, it } from 'vitest';
import { defaultState, LIMITS, type PlateState } from '../geo/state';
import { addHole, duplicateElement, elementName, nudgeElement, removeElement, toggleVisible } from './edit';

const withHoles = (n: number): PlateState => {
  let state = defaultState();
  for (let i = 0; i < n; i++) state = addHole(state).state;
  return state;
};

describe('addHole', () => {
  it('adds a round hole at the centre and gives its id', () => {
    const { state, id } = addHole(defaultState());
    expect(id).toBe('h1');
    expect(state.holes[0]).toMatchObject({ id: 'h1', kind: 'round', x: 0, y: 0 });
    expect(addHole(state).id).toBe('h2');
  });

  it('adds nothing past the limit', () => {
    const full = withHoles(LIMITS.holes);
    expect(addHole(full)).toEqual({ state: full, id: null });
  });
});

describe('duplicateElement', () => {
  it('puts a copy next to the original, shifted, with a new id', () => {
    const state = withHoles(2);
    Object.assign(state.holes[1] ?? {}, { x: 10, kind: 'slot' });
    const { state: next, id } = duplicateElement(state, 'h1');
    expect(id).toBe('h3');
    expect(next.holes.map((h) => h.id)).toEqual(['h1', 'h3', 'h2']);
    expect(next.holes[1]).toMatchObject({ x: 5, y: -5, kind: 'round' });
  });

  it('does nothing for an unknown id or at the limit', () => {
    const full = withHoles(LIMITS.holes);
    expect(duplicateElement(full, 'h1').id).toBeNull();
    expect(duplicateElement(defaultState(), 'h9').id).toBeNull();
  });
});

describe('removeElement, toggleVisible, nudgeElement', () => {
  it('edit one element by id', () => {
    const state = withHoles(2);
    expect(removeElement(state, 'h1').holes.map((h) => h.id)).toEqual(['h2']);
    expect(toggleVisible(state, 'h2').holes[1]?.visible).toBe(false);
    expect(nudgeElement(state, 'h2', 0.5, -5).holes[1]).toMatchObject({ x: 0.5, y: -5 });
    expect(nudgeElement(state, 'nope', 1, 1)).toBe(state);
  });
});

const name = (kind: 'image' | 'text' | 'hole', n: number) => `${kind} ${n}`;

describe('elementName', () => {
  it('numbers elements within their kind', () => {
    const state = withHoles(3);
    expect(elementName(state, 'h3', name)).toBe('hole 3');
    expect(elementName(removeElement(state, 'h1'), 'h3', name)).toBe('hole 2');
    expect(elementName(state, 'x', name)).toBe('');
  });
});
