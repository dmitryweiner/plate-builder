// The Warnings card (spec §7.2, §10): each warning with the elements it
// names and a "show" that frames its spot in the 2D view.

import type { PlateState } from '../geo/state';
import type { MeshProblem } from '../geo/validate';
import type { Warning } from '../geo/warnings';
import type { Messages } from '../i18n';
import { elementName } from '../state/edit';
import { make } from 'maker-kit/ui/dom';

export function warningText(t: Messages, w: Warning, state: PlateState, problems: readonly MeshProblem[] = []): string {
  const names = w.ids.map((id) => elementName(state, id, t.elementName)).join(', ');
  const mm = (key: string) => w.params?.[key] ?? 0;
  const texts: Record<Warning['code'], () => string> = {
    'element.outside': () => t.warning.outside(names),
    'element.overlap': () => t.warning.overlap(names),
    'hole.nearEdge': () => t.warning.nearEdge(names, mm('distance')),
    'keyhole.thin': () => t.warning.keyholeThin(names, mm('needed')),
    'outline.islands': () => t.warning.islands(mm('count')),
    'outline.empty': () => t.warning.empty,
    'text.thin': () => t.warning.textThin(names),
    'frame.thin': () => t.warning.frameThin,
    'relief.tall': () => t.warning.reliefTall(mm('times')),
    'mesh.invalid': () => t.meshBlocked(problems.map((p) => t.meshProblem[p]).join(', ')),
    'text.arcLines': () => t.warning.arcLines(names),
    'text.buried': () => t.warning.buried(names),
    'text.onEdge': () => t.warning.onEdge(names),
    'text.arcTooLong': () => t.warning.arcTooLong(names, mm('percent')),
    'magnet.thin': () => t.warning.magnetThin(mm('needed')),
    'magnet.noRoom': () => t.warning.magnetNoRoom,
    'magnet.overlap': () => t.warning.magnetOverlap(names),
  };
  return texts[w.code]();
}

export function renderWarnings(
  card: HTMLElement,
  list: HTMLElement,
  warnings: readonly Warning[],
  state: PlateState,
  t: Messages,
  /** frames the spot of the warning at this place in the list (looked up when clicked: spots follow the elements) */
  show: (index: number) => void,
  problems: readonly MeshProblem[] = [],
): void {
  card.hidden = warnings.length === 0;
  list.textContent = '';
  for (const [index, w] of warnings.entries()) {
    const item = make('li', 'warning');
    item.dataset.code = w.code;
    const button = make('button', 'link-button', t.show);
    button.type = 'button';
    button.addEventListener('click', () => show(index));
    item.append(make('span', undefined, warningText(t, w, state, problems)));
    // a broken mesh is no place on the plate
    if (w.code !== 'mesh.invalid') item.append(button);
    list.append(item);
  }
}
