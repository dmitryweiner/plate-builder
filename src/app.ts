import { detectLocale, direction, isLocale, messages, staticText, type Locale, type Messages } from './i18n';
import { loadSettings, saveSettings, type KeyValueStorage, type Settings } from './storage';

export interface AppOptions {
  storage?: KeyValueStorage | null;
  /** Browser languages in preference order (`navigator.languages`). */
  languages?: readonly string[];
  /** Starts the geometry worker and resolves with the time it took to answer. */
  ping: () => Promise<{ ms: number }>;
}

/** What the geometry engine is doing, as the page shows it. */
type Engine = { state: 'loading' } | { state: 'ready'; ms: number } | { state: 'failed'; reason: string };

function engineText(t: Messages, engine: Engine): string {
  if (engine.state === 'ready') return t.engineReady(engine.ms);
  if (engine.state === 'failed') return t.engineFailed(engine.reason);
  return t.engineLoading;
}

function required<T extends Element>(selector: string, type: abstract new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`index.html has no ${selector}`);
  return el;
}

/** Translates the static page: texts and labels marked in index.html, title, description, lang and dir. */
function translatePage(locale: Locale, t: Messages) {
  document.documentElement.lang = locale;
  document.documentElement.dir = direction(locale);
  document.title = t.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const text = staticText(t, el.dataset.i18n ?? '');
    if (text !== undefined) el.textContent = text;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const text = staticText(t, el.dataset.i18nLabel ?? '');
    if (text !== undefined) el.setAttribute('aria-label', text);
  }
}

/** Starts the app on the current page; returns a function that removes its listeners. */
export function startApp({ storage = null, languages = [], ping }: AppOptions): () => void {
  const localeSelect = required('#locale', HTMLSelectElement);
  const engineOutput = required('#engine', HTMLOutputElement);

  let settings: Settings = loadSettings(storage);
  let locale: Locale = detectLocale(settings.locale, languages);
  let engine: Engine = { state: 'loading' };
  let stopped = false;

  const render = () => {
    const t = messages[locale];
    translatePage(locale, t);
    localeSelect.value = locale;
    engineOutput.textContent = engineText(t, engine);
  };
  const update = (next: Settings) => {
    settings = next;
    saveSettings(storage, settings);
    render();
  };
  const setEngine = (next: Engine) => {
    if (stopped) return;
    engine = next;
    render();
  };

  const onLocale = () => {
    const value = localeSelect.value;
    if (!isLocale(value)) return;
    locale = value;
    update({ ...settings, locale: value });
  };

  localeSelect.addEventListener('change', onLocale);
  render();
  ping().then(
    ({ ms }) => setEngine({ state: 'ready', ms }),
    (error: unknown) => setEngine({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }),
  );

  return () => {
    stopped = true;
    localeSelect.removeEventListener('change', onLocale);
  };
}
