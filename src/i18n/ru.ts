import type { Messages } from './en';

export const ru: Messages = {
  title: 'Конструктор табличек',
  description: 'Плоская табличка — вывеска, брелок, жетон — в STL для 3D-печати.',
  heading: 'Конструктор табличек',
  intro: 'Табличка для 3D-печати: контур, картинки, надписи и отверстия.',
  languageLabel: 'Язык',
  source: 'Исходный код',
  engineLoading: 'Загрузка геометрического движка…',

  engineReady: (ms: number) => `Геометрический движок готов за ${Math.round(ms)} мс`,
  engineFailed: (reason: string) => `Геометрический движок не запустился: ${reason}`,
};
