import type { Messages } from './en';

export const uk: Messages = {
  title: 'Конструктор табличок',
  description: 'Пласка табличка — вивіска, брелок, жетон — у STL для 3D-друку.',
  heading: 'Конструктор табличок',
  intro: 'Табличка для 3D-друку: контур, зображення, написи й отвори.',
  languageLabel: 'Мова',
  source: 'Вихідний код',
  engineLoading: 'Завантаження геометричного рушія…',

  engineReady: (ms: number) => `Геометричний рушій готовий за ${Math.round(ms)} мс`,
  engineFailed: (reason: string) => `Геометричний рушій не запустився: ${reason}`,
};
