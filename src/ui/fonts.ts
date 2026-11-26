// The bundled fonts (spec §4): woff2 subsets in public/fonts with their OFL
// licences, loaded only when a text uses them, by the kit's loader
// (`maker-kit/ui/fonts`). Nothing comes from a CDN, so a rebuild always gets
// the same letters. A text waits for its font rather than being drawn with a
// fallback (the contours would change under it).

import type { FontFile } from 'maker-kit/ui/fonts';
import { createFontLoader } from 'maker-kit/ui/fonts';
import type { FontId } from '../geo/state';

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

const fonts = createFontLoader(FONTS, `${import.meta.env.BASE_URL}fonts/`);

export function fontReady(font: FontId): boolean {
  return fonts.ready(font);
}

/** Loads a font once a session, all its subsets at once (the kit's `ui/fonts`). */
export function loadFont(font: FontId): Promise<void> {
  return fonts.load(font);
}
