import type { Messages } from './en';
import { plural } from './plural';

export const he: Messages = {
  title: 'בונה שלטים',
  description: 'שלט שטוח — שלט לדלת, מחזיק מפתחות, תג — כקובץ STL להדפסה בתלת־ממד.',
  languageLabel: 'שפה',
  source: 'קוד מקור',
  mm: 'מ״מ',

  plateCard: 'שלט',
  outline: 'מתאר',
  kindRectangle: 'מלבן',
  kindEllipse: 'אליפסה',
  kindTriangle: 'משולש',
  kindPolygon: 'מצולע',
  kindStar: 'כוכב',
  kindHeart: 'לב',
  kindShield: 'מגן',
  kindTag: 'תווית',
  width: 'רוחב',
  height: 'גובה',
  thickness: 'עובי',
  rounding: 'עיגול פינות',
  sides: 'צלעות',
  points: 'קרניים',
  innerRatio: 'רדיוס פנימי',

  view3d: 'תצוגת תלת־ממד',
  cameraFront: 'מלפנים',
  cameraIso: 'בזווית',
  cameraBack: 'מאחור',

  exportCard: 'ייצוא',
  downloadStl: 'הורדת STL',
  exporting: 'בונה STL…',
  building: 'בונה…',
  engineLoading: 'טוען את מנוע הגאומטריה…',

  meshSize: (w: string, h: string, z: string) => `${w} × ${h} × ${z} מ״מ`,
  triangles: (n: number) => (n === 1 ? 'משולש אחד' : `${n} ${plural('he', n, { one: 'משולש', other: 'משולשים' })}`),
  builtIn: (ms: number) => `נבנה תוך ${Math.round(ms)} אלפיות שנייה`,
  exported: (name: string, ms: number) => `${name} נשמר, נבנה תוך ${Math.round(ms)} אלפיות שנייה`,
  engineFailed: (reason: string) => `מנוע הגאומטריה נכשל: ${reason}`,
  meshBlocked: (problems: string) => `הרשת פגומה (${problems}); אי אפשר לייצא STL.`,
  meshProblem: {
    nonFinite: 'קואורדינטות שאינן מספרים',
    badIndices: 'משולשים מצביעים על קודקודים חסרים',
    empty: 'הרשת ריקה',
    open: 'המשטח אינו סגור',
    inverted: 'המשטח הפוך',
    degenerate: 'יותר מדי משולשים מנוונים',
  },
};
