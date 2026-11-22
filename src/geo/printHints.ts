// Print hints (spec §9): the heights where a colour change makes sense —
// the top of the base and the tops of the flat reliefs (raised texts, the
// rim, the frame). Images are gradients: a colour change gives bands, not a
// picture, and the hint says so. Sealed magnets need a pause.

import { magnetPocket } from './magnets';
import type { PlateState } from './state';

export interface ColourChanges {
  /** distinct tops, mm above the bed, lowest first */
  heights: number[];
  /** images are present: their relief is a gradient */
  gradient: boolean;
}

const hundredth = (value: number) => Math.round(value * 100) / 100;

export function colourChanges(state: PlateState): ColourChanges {
  const { plate } = state;
  const t = plate.thickness;
  const tops = [t];
  for (const text of state.texts) if (text.visible && text.mode === 'raised') tops.push(t + text.height);
  if (plate.rim) tops.push(t + plate.rimHeight);
  if ((plate.kind === 'vignette' || plate.kind === 'svg') && plate.frame) tops.push(t + plate.frameHeight);
  const heights = [...new Set(tops.map(hundredth))].toSorted((a, b) => a - b);
  return { heights, gradient: state.images.some((image) => image.visible) };
}

/** Where the print pauses for sealed magnets: their pockets' ceiling, the first layer above it closes them. */
export function magnetPause(state: PlateState): number | null {
  const { magnets } = state;
  return magnets.count > 0 && magnets.mount === 'sealed' ? magnetPocket(magnets).ceiling : null;
}
