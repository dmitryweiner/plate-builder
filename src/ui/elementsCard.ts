// The element groups (spec §7.2): a card per kind — texts, images, holes —
// and in it a foldable card per element, as Case Constructor's labels sit in
// their "Labels" card; maker-kit's list card draws them. A head has the
// name, a hint (a text's first line, a hole's kind), a visibility switch,
// duplicate and delete. The open card is the selected element's: its
// controls (one node the app keeps) move into it. Selecting here selects in
// the 2D view and the other way round.

import type { PlateElement, PlateState } from '../geo/state';
import type { Messages } from '../i18n';
import { elementName } from '../state/edit';
import type { ListItem } from 'maker-kit/ui/listCard';
import { HOLE_LABELS } from './selectedCard';

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

/** A group's rows for the kit's list card. */
export function elementItems(state: PlateState, type: ElementType, t: Messages): ListItem[] {
  return elementsOf(state, type).map((e) => ({
    id: e.id,
    title: elementName(state, e.id, t.elementName),
    hint: elementHint(e, t),
    icon: e.type === 'hole' ? ICONS[e.kind] : ICONS[e.type],
    visible: e.visible,
  }));
}
