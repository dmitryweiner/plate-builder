import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_IDS } from '../geo/state';
import { FONTS } from './fonts';

const fonts = resolve(__dirname, '../../public/fonts');

describe('bundled fonts', () => {
  it('are the six of v1 and the seven picked later, in the menu’s order', () => {
    expect(FONT_IDS.map((id) => FONTS[id].label)).toEqual([
      'Rubik',
      'Oswald',
      'PT Serif',
      'Comfortaa',
      'Marck Script',
      'Frank Ruhl Libre',
      'Lobster',
      'Playfair Display',
      'Russo One',
      'Rubik Bubbles',
      'Pacifico',
      'Bona Nova',
      'Press Start 2P',
    ]);
  });

  it('each has a woff2 file per subset and its OFL licence beside them', () => {
    for (const id of FONT_IDS) {
      const { file, subsets } = FONTS[id];
      for (const subset of subsets) expect(existsSync(resolve(fonts, `${file}-${subset}.woff2`)), `${file}-${subset}`).toBe(true);
      expect(readFileSync(resolve(fonts, `${file}-LICENSE.txt`), 'utf8')).toContain('SIL Open Font License');
    }
  });

  it('each has Latin and Cyrillic, or Latin and Hebrew, and a family of its own', () => {
    for (const id of FONT_IDS) {
      const { subsets } = FONTS[id];
      expect(subsets).toContain('latin');
      expect(subsets.includes('cyrillic') || subsets.includes('hebrew')).toBe(true);
    }
    const families = FONT_IDS.map((id) => FONTS[id].family);
    expect(new Set(families).size).toBe(families.length);
  });
});
