// The Plate card's controls (spec §7.2): outline kind and its parameters,
// thickness, corner rounding.

import { PRIMITIVE_KINDS, RANGES, type Plate, type PlateState, type PrimitiveKind } from '../geo/state';
import type { Control, TextKey } from './controls';

type OfferedKind = PrimitiveKind | 'crop';

const KIND_LABELS: Record<OfferedKind, TextKey> = {
  rectangle: 'kindRectangle',
  ellipse: 'kindEllipse',
  triangle: 'kindTriangle',
  polygon: 'kindPolygon',
  star: 'kindStar',
  heart: 'kindHeart',
  shield: 'kindShield',
  tag: 'kindTag',
  crop: 'kindCrop',
};

/** The kinds offered so far; vignettes and an own SVG join in M6. */
const OFFERED: readonly OfferedKind[] = [...PRIMITIVE_KINDS, 'crop'];

const setPlate = (state: PlateState, over: Partial<Plate>): PlateState => ({ ...state, plate: { ...state.plate, ...over } });

const isOffered = (value: string): value is OfferedKind => OFFERED.some((kind) => kind === value);
const sized = (s: PlateState) => s.plate.kind !== 'crop';

export const plateControls: readonly Control<PlateState>[] = [
  {
    kind: 'select',
    key: 'kind',
    label: 'outline',
    options: OFFERED.map((value) => ({ value, label: KIND_LABELS[value] })),
    get: (s) => s.plate.kind,
    set: (s, kind) => (isOffered(kind) ? setPlate(s, { kind }) : s),
  },
  {
    kind: 'range',
    key: 'padding',
    label: 'padding',
    ...RANGES.padding,
    step: 0.5,
    unit: 'mm',
    when: (s) => !sized(s),
    get: (s) => s.plate.padding,
    set: (s, padding) => setPlate(s, { padding }),
  },
  {
    kind: 'range',
    key: 'width',
    label: 'width',
    ...RANGES.plateSize,
    step: 0.5,
    when: sized,
    unit: 'mm',
    get: (s) => s.plate.width,
    set: (s, width) => setPlate(s, { width }),
  },
  {
    kind: 'range',
    key: 'height',
    label: 'height',
    ...RANGES.plateSize,
    step: 0.5,
    when: sized,
    unit: 'mm',
    get: (s) => s.plate.height,
    set: (s, height) => setPlate(s, { height }),
  },
  {
    kind: 'range',
    key: 'thickness',
    label: 'thickness',
    ...RANGES.thickness,
    step: 0.1,
    unit: 'mm',
    get: (s) => s.plate.thickness,
    set: (s, thickness) => setPlate(s, { thickness }),
  },
  {
    kind: 'range',
    key: 'rounding',
    label: 'rounding',
    min: 0,
    max: (s) => Math.min(s.plate.width, s.plate.height) / 2,
    step: 0.5,
    unit: 'mm',
    get: (s) => s.plate.rounding,
    set: (s, rounding) => setPlate(s, { rounding }),
  },
  {
    kind: 'range',
    key: 'sides',
    label: 'sides',
    ...RANGES.sides,
    step: 1,
    when: (s) => s.plate.kind === 'polygon',
    get: (s) => s.plate.sides,
    set: (s, sides) => setPlate(s, { sides }),
  },
  {
    kind: 'range',
    key: 'points',
    label: 'points',
    ...RANGES.points,
    step: 1,
    when: (s) => s.plate.kind === 'star',
    get: (s) => s.plate.points,
    set: (s, points) => setPlate(s, { points }),
  },
  {
    kind: 'range',
    key: 'innerRatio',
    label: 'innerRatio',
    ...RANGES.innerRatio,
    step: 0.05,
    when: (s) => s.plate.kind === 'star',
    get: (s) => s.plate.innerRatio,
    set: (s, innerRatio) => setPlate(s, { innerRatio }),
  },
  { kind: 'check', key: 'rim', label: 'rim', get: (s) => s.plate.rim, set: (s, rim) => setPlate(s, { rim }) },
  {
    kind: 'range',
    key: 'rimWidth',
    label: 'rimWidth',
    ...RANGES.rimWidth,
    step: 0.1,
    unit: 'mm',
    when: (s) => s.plate.rim,
    get: (s) => s.plate.rimWidth,
    set: (s, rimWidth) => setPlate(s, { rimWidth }),
  },
  {
    kind: 'range',
    key: 'rimHeight',
    label: 'rimHeight',
    ...RANGES.rimHeight,
    step: 0.1,
    unit: 'mm',
    when: (s) => s.plate.rim,
    get: (s) => s.plate.rimHeight,
    set: (s, rimHeight) => setPlate(s, { rimHeight }),
  },
];
