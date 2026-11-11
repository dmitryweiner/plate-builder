// The Warnings card (spec §7.2, §10): each warning with the elements it
// names and a "show" that frames its spot in the 2D view, drawn by the
// kit's message list.

import type { PlateState } from '../geo/state';
import type { Warning } from '../geo/warnings';
import type { Messages } from '../i18n';
import { elementName } from '../state/edit';
import type { MessageLine } from 'maker-kit/ui/messageList';

/** `problems`: what blocks the export, as text (the kit's `kit.mesh.*` sentences). */
export function warningText(t: Messages, w: Warning, state: PlateState, problems: readonly string[] = []): string {
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
    'mesh.invalid': () => t.meshBlocked(problems.join(' ')),
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

/** The card's lines for the kit's message list: a broken mesh blocks the export, the rest are warnings. */
export function warningLines(
  warnings: readonly Warning[],
  state: PlateState,
  t: Messages,
  /** frames the spot of the warning at this place in the list (looked up when clicked: spots follow the elements) */
  show: (index: number) => void,
  problems: readonly string[] = [],
): MessageLine[] {
  return warnings.map((w, index) => ({
    severity: w.code === 'mesh.invalid' ? 'bad' : 'warn',
    text: warningText(t, w, state, problems),
    code: w.code,
    // a broken mesh is no place on the plate
    ...(w.code === 'mesh.invalid' ? {} : { action: { label: t.show, run: () => show(index) } }),
  }));
}
