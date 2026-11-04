// Edits of the element lists, as pure functions of the state. Each returns
// a sanitised state; those that make an element also return its id, so the
// app can select it.

import { allElements, findElement, replaceElement } from '../editor/elements';
import { defaultHole, LIMITS, sanitizeState, type HoleKind, type PlateElement, type PlateState } from '../geo/state';

/** How far a copy lands from its original, mm: right and down, visibly apart. */
const DUPLICATE_OFFSET = 5;

export function addHole(state: PlateState, kind: HoleKind = 'round'): { state: PlateState; id: string | null } {
  if (state.holes.length >= LIMITS.holes) return { state, id: null };
  const next = sanitizeState({ ...state, holes: [...state.holes, defaultHole(kind)] });
  return { state: next, id: next.holes.at(-1)?.id ?? null };
}

const listOf = (state: PlateState, e: PlateElement): readonly PlateElement[] =>
  e.type === 'image' ? state.images : e.type === 'text' ? state.texts : state.holes;
const limitOf = (e: PlateElement): number => (e.type === 'image' ? LIMITS.images : e.type === 'text' ? LIMITS.texts : LIMITS.holes);

/** Inserts `copy` right after `original` in its list. */
function insertAfter(state: PlateState, original: PlateElement, copy: PlateElement): PlateState {
  const after = <E extends PlateElement>(list: readonly E[], item: E): E[] => list.flatMap((e) => (e.id === original.id ? [e, item] : [e]));
  if (copy.type === 'image') return { ...state, images: after(state.images, copy) };
  if (copy.type === 'text') return { ...state, texts: after(state.texts, copy) };
  return { ...state, holes: after(state.holes, copy) };
}

export function duplicateElement(state: PlateState, id: string): { state: PlateState; id: string | null } {
  const original = findElement(state, id);
  if (!original || listOf(state, original).length >= limitOf(original)) return { state, id: null };
  const copy = { ...original, id: '', x: original.x + DUPLICATE_OFFSET, y: original.y - DUPLICATE_OFFSET };
  const next = sanitizeState(insertAfter(state, original, copy));
  const before = new Set(allElements(state).map((e) => e.id));
  return { state: next, id: allElements(next).find((e) => !before.has(e.id))?.id ?? null };
}

export function removeElement(state: PlateState, id: string): PlateState {
  return {
    ...state,
    images: state.images.filter((e) => e.id !== id),
    texts: state.texts.filter((e) => e.id !== id),
    holes: state.holes.filter((e) => e.id !== id),
  };
}

export function toggleVisible(state: PlateState, id: string): PlateState {
  const e = findElement(state, id);
  return e ? replaceElement(state, { ...e, visible: !e.visible }) : state;
}

export function nudgeElement(state: PlateState, id: string, dx: number, dy: number): PlateState {
  const e = findElement(state, id);
  return e ? sanitizeState(replaceElement(state, { ...e, x: e.x + dx, y: e.y + dy })) : state;
}

/** "Hole 2": the element's kind and its number within the kind, from a translated pattern. */
export function elementName(state: PlateState, id: string, name: (type: PlateElement['type'], n: number) => string): string {
  const e = findElement(state, id);
  if (!e) return '';
  return name(e.type, listOf(state, e).findIndex((x) => x.id === id) + 1);
}
