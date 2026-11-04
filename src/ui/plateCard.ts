// The Plate card's controls (spec §7.2): outline kind and its parameters,
// thickness, corner rounding.

import { PRIMITIVE_KINDS, RANGES, type Plate, type PlateState, type PrimitiveKind } from '../geo/state';
import type { Control, TextKey } from './controls';

const KIND_LABELS: Record<PrimitiveKind, TextKey> = {
  rectangle: 'kindRectangle',
  ellipse: 'kindEllipse',
  triangle: 'kindTriangle',
  polygon: 'kindPolygon',
  star: 'kindStar',
  heart: 'kindHeart',
  shield: 'kindShield',
  tag: 'kindTag',
};

const setPlate = (state: PlateState, over: Partial<Plate>): PlateState => ({ ...state, plate: { ...state.plate, ...over } });

const isPrimitive = (value: string): value is PrimitiveKind => PRIMITIVE_KINDS.some((kind) => kind === value);

export const plateControls: readonly Control<PlateState>[] = [
  {
    kind: 'select',
    key: 'kind',
    label: 'outline',
    options: PRIMITIVE_KINDS.map((value) => ({ value, label: KIND_LABELS[value] })),
    get: (s) => s.plate.kind,
    set: (s, kind) => (isPrimitive(kind) ? setPlate(s, { kind }) : s),
  },
  {
    kind: 'range',
    key: 'width',
    label: 'width',
    ...RANGES.plateSize,
    step: 0.5,
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
];
