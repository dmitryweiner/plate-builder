import type { Messages } from './en';
import { plural } from './plural';

export const uk: Messages = {
  title: 'Конструктор табличок',
  description: 'Пласка табличка — вивіска, брелок, жетон — у STL для 3D-друку.',
  languageLabel: 'Мова',
  source: 'Вихідний код',
  mm: 'мм',

  plateCard: 'Табличка',
  outline: 'Контур',
  kindRectangle: 'Прямокутник',
  kindEllipse: 'Еліпс',
  kindTriangle: 'Трикутник',
  kindPolygon: 'Многокутник',
  kindStar: 'Зірка',
  kindHeart: 'Серце',
  kindShield: 'Щит',
  kindTag: 'Бирка',
  width: 'Ширина',
  height: 'Висота',
  thickness: 'Товщина',
  rounding: 'Заокруглення кутів',
  sides: 'Сторони',
  points: 'Промені',
  innerRatio: 'Внутрішній радіус',

  view3d: '3D-вигляд',
  cameraFront: 'Спереду',
  cameraIso: 'Збоку',
  cameraBack: 'Ззаду',

  exportCard: 'Експорт',
  downloadStl: 'Завантажити STL',
  exporting: 'Будую STL…',
  building: 'Будую…',
  engineLoading: 'Завантаження геометричного рушія…',

  meshSize: (w: string, h: string, z: string) => `${w} × ${h} × ${z} мм`,
  triangles: (n: number) => `${n} ${plural('uk', n, { one: 'трикутник', few: 'трикутники', many: 'трикутників', other: 'трикутника' })}`,
  builtIn: (ms: number) => `побудовано за ${Math.round(ms)} мс`,
  exported: (name: string, ms: number) => `${name} збережено, побудовано за ${Math.round(ms)} мс`,
  engineFailed: (reason: string) => `Геометричний рушій не впорався: ${reason}`,
  meshBlocked: (problems: string) => `Сітка зіпсована (${problems}); STL не експортувати.`,
  meshProblem: {
    nonFinite: 'координати — не числа',
    badIndices: 'трикутники посилаються на неіснуючі вершини',
    empty: 'сітка порожня',
    open: 'поверхня не замкнена',
    inverted: 'поверхня вивернута',
    degenerate: 'забагато вироджених трикутників',
  },
};
