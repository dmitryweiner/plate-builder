// The Elements card's list (spec §7.2): a row per element with its name,
// a visibility switch, duplicate and delete. Selecting here selects in the
// 2D view and the other way round.

import { allElements } from '../editor/elements';
import type { PlateState } from '../geo/state';
import type { Messages } from '../i18n';
import { elementName } from '../state/edit';
import { make } from './dom';

export interface ElementActions {
  select(id: string): void;
  toggle(id: string): void;
  duplicate(id: string): void;
  remove(id: string): void;
}

/** Symbols of the element kinds, the hole's by its kind. */
const ICONS = { image: '▣', text: 'T', round: '○', slot: '⊂⊃', countersunk: '◎', keyhole: '⚲' } as const;

export function renderElementList(
  list: HTMLElement,
  state: PlateState,
  selected: string | null,
  t: Messages,
  actions: ElementActions,
): void {
  list.textContent = '';
  const elements = allElements(state);
  if (elements.length === 0) {
    list.append(make('li', 'note', t.noElements));
    return;
  }
  for (const e of elements) {
    const name = elementName(state, e.id, t.elementName);
    const row = make('li', 'element-row');
    row.dataset.id = e.id;
    row.classList.toggle('selected', e.id === selected);
    row.classList.toggle('hidden-element', !e.visible);

    const pick = make('button', 'element-name');
    pick.type = 'button';
    pick.append(make('span', 'element-icon', e.type === 'hole' ? ICONS[e.kind] : ICONS[e.type]), make('span', undefined, name));
    pick.setAttribute('aria-pressed', String(e.id === selected));
    pick.addEventListener('click', () => actions.select(e.id));

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

    row.append(pick, eye, copy, remove);
    list.append(row);
  }
}
