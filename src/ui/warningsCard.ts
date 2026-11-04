// The Warnings card (spec §7.2, §10): each warning with the elements it
// names and a "show" that frames its spot in the 2D view.

import type { Point } from '../geo/outline';
import type { PlateState } from '../geo/state';
import type { Warning } from '../geo/warnings';
import type { Messages } from '../i18n';
import { elementName } from '../state/edit';
import { make } from './dom';

export function warningText(t: Messages, w: Warning, state: PlateState): string {
  const names = w.ids.map((id) => elementName(state, id, t.elementName)).join(', ');
  const mm = (key: string) => w.params?.[key] ?? 0;
  const texts: Record<Warning['code'], () => string> = {
    'element.outside': () => t.warning.outside(names),
    'element.overlap': () => t.warning.overlap(names),
    'hole.nearEdge': () => t.warning.nearEdge(names, mm('distance')),
    'keyhole.thin': () => t.warning.keyholeThin(names, mm('needed')),
  };
  return texts[w.code]();
}

export function renderWarnings(
  card: HTMLElement,
  list: HTMLElement,
  warnings: readonly Warning[],
  state: PlateState,
  t: Messages,
  show: (spot: Point) => void,
): void {
  card.hidden = warnings.length === 0;
  list.textContent = '';
  for (const w of warnings) {
    const item = make('li', 'warning');
    item.dataset.code = w.code;
    const button = make('button', 'link-button', t.show);
    button.type = 'button';
    button.addEventListener('click', () => show(w.spot));
    item.append(make('span', undefined, warningText(t, w, state)), button);
    list.append(item);
  }
}
