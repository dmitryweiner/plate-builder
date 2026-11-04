// The element groups (spec §7.2): a card per kind — texts, images, holes —
// and in it a foldable card per element, as Case Constructor's labels sit in
// their "Labels" card. A head has the name, a hint (a text's first line, a
// hole's kind), a visibility switch, duplicate and delete. The open card is
// the selected element's: its controls (one node the app keeps) move into
// it. Selecting here selects in the 2D view and the other way round.

import type { PlateElement, PlateState } from '../geo/state';
import type { Messages } from '../i18n';
import { elementName } from '../state/edit';
import { make } from './dom';
import { HOLE_LABELS } from './selectedCard';

export interface ElementActions {
  /** null deselects: a click on the open card's head */
  select(id: string | null): void;
  toggle(id: string): void;
  duplicate(id: string): void;
  remove(id: string): void;
}

export type ElementType = PlateElement['type'];

/** Symbols of the element kinds, the hole's by its kind. */
const ICONS = { image: '▣', text: 'T', round: '○', slot: '⊂⊃', countersunk: '◎', keyhole: '⚲' } as const;

export function elementsOf(state: PlateState, type: ElementType): readonly PlateElement[] {
  return type === 'text' ? state.texts : type === 'image' ? state.images : state.holes;
}

/** What follows the name in a head: a text's first line, a hole's kind. */
export function elementHint(e: PlateElement, t: Messages): string {
  if (e.type === 'text') return e.text.split('\n').find((line) => line.trim() !== '') ?? '';
  if (e.type === 'hole') return t[HOLE_LABELS[e.kind]];
  return '';
}

/** Fills a group's list; the selected element's card gets `body`. */
export function renderElementGroup(
  list: HTMLElement,
  type: ElementType,
  state: PlateState,
  selected: string | null,
  t: Messages,
  actions: ElementActions,
  body: HTMLElement,
): void {
  list.textContent = '';
  for (const e of elementsOf(state, type)) {
    const name = elementName(state, e.id, t.elementName);
    const open = e.id === selected;
    const row = make('li', 'element-row');
    row.dataset.id = e.id;
    row.classList.toggle('open', open);
    row.classList.toggle('hidden-element', !e.visible);

    const head = make('div', 'element-head');
    const pick = make('button', 'element-name');
    pick.type = 'button';
    pick.setAttribute('aria-expanded', String(open));
    pick.append(
      make('span', 'element-caret', open ? '▾' : '▸'),
      make('span', 'element-icon', e.type === 'hole' ? ICONS[e.kind] : ICONS[e.type]),
      make('span', 'element-title', name),
      make('span', 'element-hint', elementHint(e, t)),
    );
    pick.addEventListener('click', () => actions.select(open ? null : e.id));

    const eye = make('input', 'element-visible');
    eye.type = 'checkbox';
    eye.checked = e.visible;
    eye.title = t.visible;
    eye.setAttribute('aria-label', `${t.visible}: ${name}`);
    eye.addEventListener('change', () => actions.toggle(e.id));

    const copy = make('button', 'icon-button', '⧉');
    copy.type = 'button';
    copy.title = t.duplicate;
    copy.setAttribute('aria-label', `${t.duplicate}: ${name}`);
    copy.addEventListener('click', () => actions.duplicate(e.id));

    const remove = make('button', 'icon-button', '✕');
    remove.type = 'button';
    remove.title = t.remove;
    remove.setAttribute('aria-label', `${t.remove}: ${name}`);
    remove.addEventListener('click', () => actions.remove(e.id));

    head.append(pick, eye, copy, remove);
    row.append(head);
    if (open) {
      body.hidden = false;
      row.append(body);
    }
    list.append(row);
  }
}

/** Updates the hints in place: typing a text must not rebuild its card. */
export function syncHints(list: HTMLElement, state: PlateState, type: ElementType, t: Messages): void {
  for (const e of elementsOf(state, type)) {
    const hint = list.querySelector(`.element-row[data-id="${e.id}"] .element-hint`);
    const text = elementHint(e, t);
    if (hint && hint.textContent !== text) hint.textContent = text;
  }
}
