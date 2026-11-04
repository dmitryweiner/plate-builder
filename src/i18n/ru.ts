import type { Messages } from './en';
import { plural } from './plural';

export const ru: Messages = {
  title: 'Конструктор табличек',
  description: 'Плоская табличка — вывеска, брелок, жетон — в STL для 3D-печати.',
  languageLabel: 'Язык',
  source: 'Исходный код',
  mm: 'мм',

  plateCard: 'Табличка',
  outline: 'Контур',
  kindRectangle: 'Прямоугольник',
  kindEllipse: 'Эллипс',
  kindTriangle: 'Треугольник',
  kindPolygon: 'Многоугольник',
  kindStar: 'Звезда',
  kindHeart: 'Сердце',
  kindShield: 'Щит',
  kindTag: 'Бирка',
  width: 'Ширина',
  height: 'Высота',
  thickness: 'Толщина',
  rounding: 'Скругление углов',
  sides: 'Стороны',
  points: 'Лучи',
  innerRatio: 'Внутренний радиус',

  view3d: '3D-вид',
  cameraFront: 'Спереди',
  cameraIso: 'Сбоку',
  cameraBack: 'Сзади',

  exportCard: 'Экспорт',
  downloadStl: 'Скачать STL',
  exporting: 'Строю STL…',
  building: 'Строю…',
  engineLoading: 'Загрузка геометрического движка…',

  meshSize: (w: string, h: string, z: string) => `${w} × ${h} × ${z} мм`,
  triangles: (n: number) =>
    `${n} ${plural('ru', n, { one: 'треугольник', few: 'треугольника', many: 'треугольников', other: 'треугольника' })}`,
  builtIn: (ms: number) => `построено за ${Math.round(ms)} мс`,
  exported: (name: string, ms: number) => `${name} сохранён, построен за ${Math.round(ms)} мс`,
  engineFailed: (reason: string) => `Геометрический движок не справился: ${reason}`,
  meshBlocked: (problems: string) => `Сетка испорчена (${problems}); STL не экспортировать.`,
  meshProblem: {
    nonFinite: 'координаты — не числа',
    badIndices: 'треугольники ссылаются на несуществующие вершины',
    empty: 'сетка пуста',
    open: 'поверхность не замкнута',
    inverted: 'поверхность вывернута',
    degenerate: 'слишком много вырожденных треугольников',
  },
};
