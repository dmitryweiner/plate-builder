// The bundled fonts (spec §4): woff2 subsets in public/fonts with their OFL
// licences, loaded only when a text uses them. Nothing comes from a CDN, so
// a rebuild always gets the same letters. A text waits for its font rather
// than being drawn with a fallback (the contours would change under it).

import type { FontId } from '../geo/state';
import type { FontSpec } from './textRaster';

type Subset = 'latin' | 'cyrillic' | 'hebrew';

interface FontFile extends FontSpec {
  /** the name in the font menu: the font's own, in Latin letters */
  label: string;
  file: string;
  subsets: readonly Subset[];
}

export const FONTS: Record<FontId, FontFile> = {
  rubik: { family: 'plate-rubik', label: 'Rubik', file: 'rubik', weight: '700', subsets: ['latin', 'cyrillic', 'hebrew'] },
  oswald: { family: 'plate-oswald', label: 'Oswald', file: 'oswald', weight: '600', subsets: ['latin', 'cyrillic'] },
  ptSerif: { family: 'plate-pt-serif', label: 'PT Serif', file: 'pt-serif', weight: '700', subsets: ['latin', 'cyrillic'] },
  comfortaa: { family: 'plate-comfortaa', label: 'Comfortaa', file: 'comfortaa', weight: '700', subsets: ['latin', 'cyrillic'] },
  marckScript: { family: 'plate-marck-script', label: 'Marck Script', file: 'marck-script', weight: '400', subsets: ['latin', 'cyrillic'] },
  frankRuhl: { family: 'plate-frank-ruhl', label: 'Frank Ruhl Libre', file: 'frank-ruhl', weight: '700', subsets: ['latin', 'hebrew'] },
  lobster: { family: 'plate-lobster', label: 'Lobster', file: 'lobster', weight: '400', subsets: ['latin', 'cyrillic'] },
  playfair: {
    family: 'plate-playfair-display',
    label: 'Playfair Display',
    file: 'playfair-display',
    weight: '900',
    subsets: ['latin', 'cyrillic'],
  },
  russoOne: { family: 'plate-russo-one', label: 'Russo One', file: 'russo-one', weight: '400', subsets: ['latin', 'cyrillic'] },
  rubikBubbles: {
    family: 'plate-rubik-bubbles',
    label: 'Rubik Bubbles',
    file: 'rubik-bubbles',
    weight: '400',
    subsets: ['latin', 'cyrillic', 'hebrew'],
  },
  pacifico: { family: 'plate-pacifico', label: 'Pacifico', file: 'pacifico', weight: '400', subsets: ['latin', 'cyrillic'] },
  bonaNova: { family: 'plate-bona-nova', label: 'Bona Nova', file: 'bona-nova', weight: '700', subsets: ['latin', 'cyrillic', 'hebrew'] },
  pressStart: {
    family: 'plate-press-start-2p',
    label: 'Press Start 2P',
    file: 'press-start-2p',
    weight: '400',
    subsets: ['latin', 'cyrillic'],
  },
};

/** The subsets' ranges, as Google Fonts cut them. */
const RANGES: Record<Subset, string> = {
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  hebrew: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
};

const loading = new Map<FontId, Promise<void>>();
const ready = new Set<FontId>();

export function fontReady(font: FontId): boolean {
  return ready.has(font);
}

/**
 * Loads a font once a session, all its subsets at once: the browser would
 * fetch Cyrillic only at the first Cyrillic letter drawn, and a raster must
 * be whole when it is drawn.
 */
export function loadFont(font: FontId): Promise<void> {
  const known = loading.get(font);
  if (known) return known;
  const spec = FONTS[font];
  const faces = spec.subsets.map(
    (subset) =>
      new FontFace(spec.family, `url(${import.meta.env.BASE_URL}fonts/${spec.file}-${subset}.woff2) format('woff2')`, {
        weight: spec.weight,
        unicodeRange: RANGES[subset],
      }),
  );
  const promise = Promise.all(faces.map((face) => face.load())).then((loaded) => {
    for (const face of loaded) document.fonts.add(face);
    ready.add(font);
  });
  loading.set(font, promise);
  // a failure is not for good: the next request tries again
  promise.catch(() => loading.delete(font));
  return promise;
}
