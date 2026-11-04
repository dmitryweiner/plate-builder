import type { Messages } from './en';

export const he: Messages = {
  title: 'בונה שלטים',
  description: 'שלט שטוח — שלט לדלת, מחזיק מפתחות, תג — כקובץ STL להדפסה בתלת־ממד.',
  heading: 'בונה שלטים',
  intro: 'שלט להדפסה בתלת־ממד: מתאר, תמונות, טקסטים וחורים.',
  languageLabel: 'שפה',
  source: 'קוד מקור',
  engineLoading: 'טוען את מנוע הגאומטריה…',

  engineReady: (ms: number) => `מנוע הגאומטריה מוכן תוך ${Math.round(ms)} אלפיות שנייה`,
  engineFailed: (reason: string) => `מנוע הגאומטריה לא עלה: ${reason}`,
};
