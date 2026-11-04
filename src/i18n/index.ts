import { en, type Messages } from './en';
import { he } from './he';
import { ru } from './ru';
import { uk } from './uk';

export type { Messages };
export type Locale = 'en' | 'ru' | 'uk' | 'he';

export const LOCALES: readonly Locale[] = ['en', 'ru', 'uk', 'he'];
export const DEFAULT_LOCALE: Locale = 'en';
/** Language names for the switcher, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский', uk: 'Українська', he: 'עברית' };
const RTL_LOCALES: ReadonlySet<Locale> = new Set(['he']);

export const messages: Record<Locale, Messages> = { en, ru, uk, he };

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/** The saved locale, else the first supported browser language, else English. */
export function detectLocale(saved: unknown, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Text direction of the locale, for `<html dir>`. */
export function direction(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/** A plain string message by key (as written in index.html), or undefined. */
export function staticText(t: Messages, key: string): string | undefined {
  const record: Record<string, unknown> = t;
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}
