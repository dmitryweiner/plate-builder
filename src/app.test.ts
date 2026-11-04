// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp, type AppOptions } from './app';
import { LOCALE_NAMES, LOCALES } from './i18n';
import { loadSettings, type KeyValueStorage } from './storage';

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>')).replace(/<script[^>]*><\/script>/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

function $<T extends Element>(selector: string, type: abstract new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing ${selector}`);
  return el;
}
const text = (selector: string) => $(selector, HTMLElement).textContent;
function selectLocale(locale: string) {
  const select = $('#locale', HTMLSelectElement);
  select.value = locale;
  select.dispatchEvent(new Event('change'));
}

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

let stop: () => void = () => {};
let storage: MemoryStorage;

/** A ping that never answers: the status stays "loading". */
const silent: AppOptions['ping'] = () => new Promise(() => {});

function start(languages: readonly string[] = ['en-US'], ping = silent) {
  stop = startApp({ storage, languages, ping });
}

beforeEach(() => {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  storage = new MemoryStorage();
});
afterEach(() => stop());

describe('language', () => {
  it('lists every locale in the switcher by its own name', () => {
    const options = [...$('#locale', HTMLSelectElement).options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual(LOCALES.map((l) => [l, LOCALE_NAMES[l]]));
  });

  it('follows the browser when nothing is saved', () => {
    start(['ru-RU', 'en']);
    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Конструктор табличек');
    expect(text('#engine')).toBe('Загрузка геометрического движка…');
    expect($('#locale', HTMLSelectElement).getAttribute('aria-label')).toBe('Язык');
  });

  it('falls back to English', () => {
    start(['de-DE']);
    expect(document.documentElement.lang).toBe('en');
    expect(text('h1')).toBe('Plate Builder');
  });

  it('saves the switcher choice and prefers it over the browser', () => {
    start(['en-US']);
    selectLocale('he');
    expect(loadSettings(storage).locale).toBe('he');
    stop();
    document.body.innerHTML = body;
    start(['ru-RU']);
    expect(document.documentElement.lang).toBe('he');
    expect($('#locale', HTMLSelectElement).value).toBe('he');
  });

  it('turns the page right-to-left for Hebrew and back', () => {
    start();
    selectLocale('he');
    expect(document.documentElement.dir).toBe('rtl');
    selectLocale('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('keeps the state when the language changes', async () => {
    start(['en-US'], () => Promise.resolve({ ms: 42 }));
    await vi.waitFor(() => expect(text('#engine')).toBe('Geometry engine ready in 42 ms'));
    selectLocale('uk');
    expect(text('#engine')).toBe('Геометричний рушій готовий за 42 мс');
  });
});

describe('geometry engine', () => {
  it('says it is loading until the worker answers', () => {
    start();
    expect(text('#engine')).toBe('Loading the geometry engine…');
  });

  it('shows the worker time once it answers', async () => {
    start(['en-US'], () => Promise.resolve({ ms: 123.4 }));
    await vi.waitFor(() => expect(text('#engine')).toBe('Geometry engine ready in 123 ms'));
  });

  it('shows why it failed', async () => {
    start(['en-US'], () => Promise.reject(new Error('no WASM')));
    await vi.waitFor(() => expect(text('#engine')).toBe('The geometry engine did not start: no WASM'));
  });

  it('ignores an answer that comes after the app stopped', async () => {
    const answer: { resolve?: (value: { ms: number }) => void } = {};
    start(['en-US'], () => new Promise((settle) => (answer.resolve = settle)));
    stop();
    answer.resolve?.({ ms: 1 });
    await Promise.resolve();
    expect(text('#engine')).toBe('Loading the geometry engine…');
  });

  it('works without storage', () => {
    stop = startApp({ storage: null, languages: [], ping: silent });
    expect(document.documentElement.lang).toBe('en');
  });
});
