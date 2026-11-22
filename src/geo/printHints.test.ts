import { describe, expect, it } from 'vitest';
import { colourChanges, magnetPause } from './printHints';
import { defaultImage, defaultState, defaultText, type PlateState, type TextElement } from './state';

function plate(over: Partial<PlateState['plate']> = {}, texts: Partial<TextElement>[] = []): PlateState {
  const state = defaultState();
  return { ...state, plate: { ...state.plate, ...over }, texts: texts.map((t, i) => ({ ...defaultText(state), id: `t${i + 1}`, ...t })) };
}

describe('colourChanges', () => {
  it('is the base’s top alone on a plain plate', () => {
    expect(colourChanges(plate({ thickness: 3 }))).toEqual({ heights: [3], gradient: false });
  });

  it('adds the tops of raised texts, the rim and the frame, in order, each once', () => {
    const state = plate({ thickness: 2, rim: true, rimHeight: 1 }, [
      { height: 1.5 },
      { height: 1 },
      { height: 1, mode: 'engraved' },
      { height: 4, visible: false },
    ]);
    expect(colourChanges(state).heights).toEqual([2, 3, 3.5]);
    const framed = plate({ kind: 'vignette', vignette: 'x', thickness: 3, frame: true, frameHeight: 0.6 });
    expect(colourChanges(framed).heights).toEqual([3, 3.6]);
    expect(colourChanges({ ...framed, plate: { ...framed.plate, frame: false } }).heights).toEqual([3]);
  });

  it('says images are a gradient', () => {
    const state = { ...plate(), images: [{ ...defaultImage(defaultState(), 'data:image/png;base64,', 4, 4), id: 'i1' }] };
    expect(colourChanges(state).gradient).toBe(true);
  });

  it('rounds to the hundredth and drops a top equal to another', () => {
    expect(colourChanges(plate({ thickness: 3 }, [{ height: 1.0000001 }, { height: 1 }])).heights).toEqual([3, 4]);
  });
});

function withMagnets(over: Partial<PlateState['magnets']>): PlateState {
  const state = plate();
  return { ...state, magnets: { ...state.magnets, count: 2, layout: 'row', ...over } };
}

describe('magnetPause', () => {
  it('is the sealed pockets’ ceiling: the first layer above it closes them', () => {
    expect(magnetPause(withMagnets({ mount: 'sealed' }))).toBe(2.6);
    expect(magnetPause(withMagnets({ mount: 'sealed', cover: 0.8 }))).toBe(3);
  });

  it('is none for glued magnets, or none at all', () => {
    expect(magnetPause(withMagnets({}))).toBeNull();
    expect(magnetPause(withMagnets({ mount: 'sealed', count: 0 }))).toBeNull();
  });
});
