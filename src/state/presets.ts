// The built-in presets (spec §11), one per kind of plate the app is for.
// Their pictures are drawn for the project (scripts/preset-pictures.mjs).
// Each is a whole state that sanitizeState leaves as it is (tested).

import {
  defaultHole,
  defaultImage,
  defaultPlate,
  defaultState,
  defaultText,
  sanitizeState,
  type HoleElement,
  type ImageElement,
  type Magnets,
  type Plate,
  type PlateState,
  type TextElement,
} from '../geo/state';
import type { Locale } from '../i18n';
import { APPLE_PICTURE, LOGO_PICTURE, PRESET_PICTURE_PX, STAR_PICTURE } from './presetPictures';

export interface BuiltInPreset {
  id: string;
  names: Record<Locale, string>;
  state: PlateState;
}

interface Recipe {
  name: string;
  plate: Partial<Plate>;
  texts?: Partial<TextElement>[];
  holes?: Partial<HoleElement>[];
  images?: (Partial<ImageElement> & { src: string })[];
  magnets?: Partial<Magnets>;
}

function make(recipe: Recipe): PlateState {
  const base = defaultState();
  const plate = { ...defaultPlate(), ...recipe.plate };
  const state = { ...base, name: recipe.name, plate };
  return sanitizeState({
    ...state,
    // each element: its kind's defaults, then the recipe's own values over them
    texts: (recipe.texts ?? []).map((text) => Object.assign(defaultText(state), text)),
    holes: (recipe.holes ?? []).map((hole) => Object.assign(defaultHole(hole.kind ?? 'round'), hole)),
    images: (recipe.images ?? []).map((image) =>
      Object.assign(defaultImage(state, image.src, PRESET_PICTURE_PX, PRESET_PICTURE_PX), image),
    ),
    magnets: { ...base.magnets, ...recipe.magnets },
  });
}

export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  {
    id: 'door-sign',
    names: { en: 'Door sign', ru: 'Табличка на дверь', uk: 'Табличка на двері', he: 'שלט לדלת' },
    state: make({
      name: 'Door sign',
      plate: { kind: 'rectangle', width: 160, height: 60, thickness: 3, rounding: 6 },
      texts: [{ text: 'Room 12\nKitchen', size: 10, lineSpacing: 1.5, height: 1.2 }],
      holes: [
        { kind: 'countersunk', x: -70, y: 0 },
        { kind: 'countersunk', x: 70, y: 0 },
      ],
    }),
  },
  {
    id: 'keychain',
    names: { en: 'Keychain', ru: 'Брелок', uk: 'Брелок', he: 'מחזיק מפתחות' },
    state: make({
      name: 'Keychain',
      plate: { kind: 'crop', padding: 4, thickness: 3, rounding: 2, edgeSize: 0.8 },
      texts: [
        { text: 'ALEX', size: 10, height: 1.5, x: 8 },
        // the letter O as a ring around the key ring's hole, close enough for the padding to join them
        { text: 'O', size: 14, height: 1.5, x: -20 },
      ],
      holes: [{ kind: 'round', diameter: 3.5, x: -20 }],
    }),
  },
  {
    id: 'pet-tag',
    names: { en: 'Pet tag', ru: 'Жетон для питомца', uk: 'Жетон для улюбленця', he: 'תג לחיית מחמד' },
    state: make({
      name: 'Pet tag',
      plate: { kind: 'ellipse', width: 40, height: 40, thickness: 2, rounding: 0, edgeSize: 0.8 },
      texts: [
        // big enough for strokes of two nozzle widths
        { text: 'BUDDY', size: 5, height: 0.8, arc: true, arcRadius: 14, arcSide: 'inside' },
        { text: '555 0123', size: 4.5, height: 0.8, y: 2 },
      ],
      holes: [{ kind: 'round', diameter: 3, y: 15 }],
    }),
  },
  {
    id: 'house-number',
    names: { en: 'House number', ru: 'Номер дома', uk: 'Номер будинку', he: 'מספר בית' },
    state: make({
      name: 'House number',
      plate: {
        kind: 'vignette',
        vignette: 'cartouche',
        width: 160,
        height: 100,
        thickness: 6,
        rounding: 0,
        keepProportions: false,
        frame: true,
        frameHeight: 1.5,
      },
      texts: [{ text: '12', size: 50, height: 2, font: 'ptSerif' }],
      holes: [
        { kind: 'keyhole', x: -50, y: 10 },
        { kind: 'keyhole', x: 50, y: 10 },
      ],
    }),
  },
  {
    id: 'medal',
    names: { en: 'Medal', ru: 'Медаль', uk: 'Медаль', he: 'מדליה' },
    state: make({
      name: 'Medal',
      plate: { kind: 'ellipse', width: 60, height: 60, thickness: 3, rounding: 0, rim: true, rimWidth: 2, rimHeight: 1, edgeSize: 0.8 },
      images: [{ src: STAR_PICTURE, size: 28, height: 1.5, y: -2 }],
      texts: [{ text: 'CHAMPION', size: 4, height: 1, arc: true, arcRadius: 20, arcSide: 'outside' }],
      holes: [{ kind: 'round', diameter: 3, y: 25.5 }],
    }),
  },
  {
    id: 'name-plate',
    names: { en: 'Name plate with a logo', ru: 'Именная табличка с логотипом', uk: 'Іменна табличка з логотипом', he: 'שלט שם עם לוגו' },
    state: make({
      name: 'Name plate',
      plate: { kind: 'rectangle', width: 120, height: 40, thickness: 3, rounding: 4 },
      images: [{ src: LOGO_PICTURE, size: 28, height: 1.2, x: -40 }],
      texts: [{ text: 'Anna Smith\nArchitect', size: 6, lineSpacing: 1.6, height: 1, align: 'left', x: 14 }],
    }),
  },
  {
    id: 'fridge-magnet',
    names: { en: 'Fridge magnet', ru: 'Магнит на холодильник', uk: 'Магніт на холодильник', he: 'מגנט למקרר' },
    state: make({
      name: 'Fridge magnet',
      plate: { kind: 'crop', padding: 3, thickness: 4, rounding: 2, edgeSize: 1 },
      images: [{ src: APPLE_PICTURE, size: 50, height: 1.5, y: 6 }],
      // close enough under the apple for the padding to join them; as high, so it is not buried under the picture's box
      texts: [{ text: 'HELLO!', size: 7, height: 1.5, y: -17 }],
      // in the apple's widest part; 1.9 mm of the plate stays over them
      magnets: { count: 2, layout: 'row', diameter: 10, thickness: 2 },
    }),
  },
];
