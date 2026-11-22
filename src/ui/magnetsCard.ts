// The Magnets card's controls (spec §5a): how many, where, how they are held, their size.

import {
  layoutFor,
  MAGNET_LAYOUT_IDS,
  MAGNET_MOUNTS,
  magnetLayouts,
  RANGES,
  type MagnetLayout,
  type MagnetMount,
  type Magnets,
  type PlateState,
} from '../geo/state';
import type { Control } from 'maker-kit/ui/controls';
import type { TextKey } from '../i18n';

const LAYOUT_LABELS: Record<MagnetLayout, TextKey> = {
  centre: 'layoutCentre',
  top: 'layoutTop',
  row: 'layoutRow',
  column: 'layoutColumn',
  topCorners: 'layoutTopCorners',
  triangle: 'layoutTriangle',
  triangleDown: 'layoutTriangleDown',
  corners: 'layoutCorners',
  diamond: 'layoutDiamond',
};

const setMagnets = (state: PlateState, over: Partial<Magnets>): PlateState => ({ ...state, magnets: { ...state.magnets, ...over } });

const MOUNT_LABELS: Record<MagnetMount, TextKey> = { glued: 'magnetGlued', sealed: 'magnetSealed' };

const isLayout = (value: string): value is MagnetLayout => MAGNET_LAYOUT_IDS.some((layout) => layout === value);
const isMount = (value: string): value is MagnetMount => MAGNET_MOUNTS.some((mount) => mount === value);
const any = (s: PlateState) => s.magnets.count > 0;

type SizeKey = 'diameter' | 'thickness' | 'fit' | 'edge' | 'cover';

const size = (
  key: SizeKey,
  label: TextKey,
  range: { min: number; max: number },
  step: number,
  when: (s: PlateState) => boolean = any,
): Control<PlateState, TextKey> => ({
  kind: 'range',
  key,
  label,
  min: range.min,
  max: range.max,
  step,
  unit: 'mm',
  when,
  get: (s) => s.magnets[key],
  set: (s, value) => setMagnets(s, { [key]: value }),
});

export const magnetControls: readonly Control<PlateState, TextKey>[] = [
  {
    kind: 'select',
    key: 'count',
    label: 'magnetCount',
    options: [{ value: '0', label: 'magnetNone' }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), text: String(n) }))],
    get: (s) => String(s.magnets.count),
    set: (s, value) => {
      const count = Number(value);
      return setMagnets(s, { count, layout: layoutFor(count, s.magnets.layout) });
    },
  },
  {
    kind: 'select',
    key: 'layout',
    label: 'magnetLayout',
    options: (s) => magnetLayouts(s.magnets.count).map((value) => ({ value, label: LAYOUT_LABELS[value] })),
    when: any,
    get: (s) => s.magnets.layout,
    set: (s, layout) => (isLayout(layout) ? setMagnets(s, { layout }) : s),
  },
  {
    kind: 'select',
    key: 'mount',
    label: 'magnetMount',
    options: MAGNET_MOUNTS.map((value) => ({ value, label: MOUNT_LABELS[value] })),
    when: any,
    get: (s) => s.magnets.mount,
    set: (s, mount) => (isMount(mount) ? setMagnets(s, { mount }) : s),
  },
  { ...size('cover', 'magnetCover', RANGES.magnetCover, 0.1, (s) => any(s) && s.magnets.mount === 'sealed'), hint: 'magnetCoverHint' },
  size('diameter', 'magnetDiameter', RANGES.magnetDiameter, 0.5),
  size('thickness', 'magnetThickness', RANGES.magnetThickness, 0.1),
  size('fit', 'magnetFit', RANGES.magnetFit, 0.05),
  size('edge', 'magnetEdge', RANGES.magnetEdge, 0.5),
];
