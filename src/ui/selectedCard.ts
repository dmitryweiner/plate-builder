// The selected element's card (spec §7.2): exact position, rotation and
// the element's own parameters.

import { findElement, replaceElement } from '../editor/elements';
import { HOLE_KINDS, RANGES, type HoleElement, type HoleKind, type PlateState } from '../geo/state';
import type { Control, TextKey } from './controls';

const HOLE_LABELS: Record<HoleKind, TextKey> = {
  round: 'holeRound',
  slot: 'holeSlot',
  countersunk: 'holeCountersunk',
  keyhole: 'holeKeyhole',
};

const isHoleKind = (value: string): value is HoleKind => HOLE_KINDS.some((kind) => kind === value);

/** A position slider reaches a little past the plate; the number field takes anything in range. */
const reachX = (s: PlateState) => s.plate.width / 2 + 20;
const reachY = (s: PlateState) => s.plate.height / 2 + 20;

/** Controls of the element `id`: position and rotation for any, the rest by its kind. */
export function elementControls(id: string): Control<PlateState>[] {
  const get = (s: PlateState) => findElement(s, id);
  const hole = (s: PlateState): HoleElement | null => {
    const e = get(s);
    return e?.type === 'hole' ? e : null;
  };
  const setHole = (s: PlateState, over: Partial<HoleElement>): PlateState => {
    const h = hole(s);
    return h ? replaceElement(s, { ...h, ...over }) : s;
  };
  const holeParam = (
    key: 'diameter' | 'length' | 'width' | 'screw' | 'head' | 'keyHead' | 'keyShank' | 'keySlot',
    label: TextKey,
    kinds: HoleKind[],
    step = 0.1,
  ): Control<PlateState> => {
    const range = {
      diameter: RANGES.holeDiameter,
      length: RANGES.slotLength,
      width: RANGES.slotWidth,
      screw: RANGES.screw,
      head: RANGES.screwHead,
      keyHead: RANGES.keyHead,
      keyShank: RANGES.keyShank,
      keySlot: RANGES.keySlot,
    }[key];
    return {
      kind: 'range',
      key,
      label,
      min: range.min,
      max: range.max,
      step,
      unit: 'mm',
      when: (s) => kinds.some((k) => k === hole(s)?.kind),
      get: (s) => hole(s)?.[key] ?? range.def,
      set: (s, value) => setHole(s, { [key]: value }),
    };
  };

  return [
    {
      kind: 'select',
      key: 'holeKind',
      label: 'holeKind',
      options: HOLE_KINDS.map((value) => ({ value, label: HOLE_LABELS[value] })),
      when: (s) => hole(s) !== null,
      get: (s) => hole(s)?.kind ?? 'round',
      set: (s, kind) => (isHoleKind(kind) ? setHole(s, { kind }) : s),
    },
    {
      kind: 'range',
      key: 'x',
      label: 'positionX',
      min: (s) => -reachX(s),
      max: reachX,
      step: 0.1,
      unit: 'mm',
      get: (s) => get(s)?.x ?? 0,
      set: (s, x) => {
        const e = get(s);
        return e ? replaceElement(s, { ...e, x }) : s;
      },
    },
    {
      kind: 'range',
      key: 'y',
      label: 'positionY',
      min: (s) => -reachY(s),
      max: reachY,
      step: 0.1,
      unit: 'mm',
      get: (s) => get(s)?.y ?? 0,
      set: (s, y) => {
        const e = get(s);
        return e ? replaceElement(s, { ...e, y }) : s;
      },
    },
    {
      kind: 'range',
      key: 'rotation',
      label: 'rotation',
      min: 0,
      max: 359,
      step: 1,
      unit: 'degrees',
      // a round hole looks the same at any angle
      when: (s) => hole(s)?.kind !== 'round',
      get: (s) => get(s)?.rotation ?? 0,
      set: (s, rotation) => {
        const e = get(s);
        return e ? replaceElement(s, { ...e, rotation }) : s;
      },
    },
    holeParam('diameter', 'diameter', ['round']),
    holeParam('length', 'length', ['slot']),
    holeParam('width', 'width', ['slot']),
    holeParam('screw', 'screw', ['countersunk']),
    holeParam('head', 'screwHead', ['countersunk']),
    holeParam('keyHead', 'keyHead', ['keyhole']),
    holeParam('keyShank', 'keyShank', ['keyhole']),
    holeParam('keySlot', 'keySlot', ['keyhole'], 0.5),
  ];
}
