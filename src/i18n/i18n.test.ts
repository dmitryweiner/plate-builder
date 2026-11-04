// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectLocale, direction, isLocale, LOCALES, messages, staticText } from './index';
import { plural } from './plural';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const keysIn = (attribute: string) => [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map((m) => m[1] ?? '');

describe('detectLocale', () => {
  it('prefers the saved locale', () => {
    expect(detectLocale('he', ['ru-RU'])).toBe('he');
  });

  it('takes the first supported browser language', () => {
    expect(detectLocale(null, ['ru-RU', 'en'])).toBe('ru');
    expect(detectLocale(null, ['de-DE', 'he-IL', 'ru'])).toBe('he');
    expect(detectLocale(null, ['en-GB', 'ru'])).toBe('en');
    expect(detectLocale(null, ['RU'])).toBe('ru');
    expect(detectLocale(null, ['uk-UA', 'ru'])).toBe('uk');
  });

  it('falls back to English', () => {
    expect(detectLocale(null, [])).toBe('en');
    expect(detectLocale(null, ['de-DE', 'fr'])).toBe('en');
    expect(detectLocale('xx', ['de'])).toBe('en');
  });
});

describe('isLocale', () => {
  it('accepts only supported locales', () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('direction', () => {
  it('is right-to-left for Hebrew only', () => {
    expect(direction('he')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
    expect(direction('ru')).toBe('ltr');
    expect(direction('uk')).toBe('ltr');
  });
});

describe('messages', () => {
  it('have the same keys in every locale', () => {
    const keys = Object.keys(messages.en).toSorted();
    for (const locale of LOCALES) expect(Object.keys(messages[locale]).toSorted()).toEqual(keys);
  });

  it.each(LOCALES)('cover every text in index.html (%s)', (locale) => {
    const keys = [...keysIn('data-i18n'), ...keysIn('data-i18n-label')];
    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys) expect({ key, text: staticText(messages[locale], key) }).toEqual({ key, text: expect.any(String) });
  });

  it('do not have static texts for unknown keys or functions', () => {
    expect(staticText(messages.en, 'missing')).toBeUndefined();
    expect(staticText(messages.en, 'triangles')).toBeUndefined();
    expect(staticText(messages.en, 'meshProblem')).toBeUndefined();
  });

  it('match the English defaults in index.html', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.title).toBe(messages.en.title);
    for (const el of doc.querySelectorAll<HTMLElement>('[data-i18n]')) {
      // Prettier may wrap long texts in index.html.
      expect(el.textContent.replace(/\s+/g, ' ').trim()).toBe(staticText(messages.en, el.dataset.i18n ?? ''));
    }
  });

  it('cover four languages', () => {
    expect(LOCALES).toEqual(['en', 'ru', 'uk', 'he']);
  });

  it('format numbers with plural forms in every language', () => {
    expect([1, 2, 5].map((n) => messages.en.triangles(n))).toEqual(['1 triangle', '2 triangles', '5 triangles']);
    expect([1, 3, 5, 21].map((n) => messages.ru.triangles(n))).toEqual([
      '1 треугольник',
      '3 треугольника',
      '5 треугольников',
      '21 треугольник',
    ]);
    expect([1, 3, 5].map((n) => messages.uk.triangles(n))).toEqual(['1 трикутник', '3 трикутники', '5 трикутників']);
    expect([1, 5].map((n) => messages.he.triangles(n))).toEqual(['משולש אחד', '5 משולשים']);
    for (const locale of LOCALES) {
      expect(messages[locale].builtIn(7.4)).toContain('7');
      expect(messages[locale].engineFailed('boom')).toContain('boom');
      expect(messages[locale].meshBlocked('x')).toContain('x');
    }
  });

  it('name every mesh problem in every language', () => {
    for (const locale of LOCALES)
      expect(Object.keys(messages[locale].meshProblem).toSorted()).toEqual(Object.keys(messages.en.meshProblem).toSorted());
  });
});

describe('plural', () => {
  it('picks the forms of each language', () => {
    const ru = { one: 'файл', few: 'файла', many: 'файлов', other: 'файла' };
    expect([1, 3, 5, 21].map((n) => plural('ru', n, ru))).toEqual(['файл', 'файла', 'файлов', 'файл']);
    const uk = { one: 'файл', few: 'файли', many: 'файлів', other: 'файлу' };
    expect([1, 3, 5, 21, 1.5].map((n) => plural('uk', n, uk))).toEqual(['файл', 'файли', 'файлів', 'файл', 'файлу']);
    expect([1, 2, 5].map((n) => plural('he', n, { one: 'a', two: 'b', other: 'c' }))).toEqual(['a', 'b', 'c']);
  });

  it('falls back to "other" when a form is missing', () => {
    expect(plural('ru', 3, { other: 'x' })).toBe('x');
  });
});
