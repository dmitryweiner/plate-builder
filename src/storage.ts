// What the app keeps in localStorage (spec §11): the language, the current
// project and the user presets, under one versioned key. Everything read is
// sanitised; a write that the browser refuses (quota, private mode) is
// reported, so the app can say the project is not kept.

import { sanitizeState, type PlateState } from './geo/state';
import { isLocale, type Locale } from './i18n';

export interface UserPreset {
  id: string;
  name: string;
  state: PlateState;
}

export interface Settings {
  /** The language picked in the switcher; null means detect from the browser. */
  locale: Locale | null;
  /** the project being edited; null on a first visit */
  project: PlateState | null;
  presets: UserPreset[];
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const STORAGE_KEY = __APP_ID__;
/** 2: the project and user presets joined the language (1 had the language alone) */
const VERSION = 2;
const PRESET_NAME_CHARS = 60;

export const DEFAULT_SETTINGS: Settings = { locale: null, project: null, presets: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readPresets(value: unknown): UserPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown, i): UserPreset[] => {
    if (!isRecord(entry) || !isRecord(entry.state)) return [];
    const id = typeof entry.id === 'string' && /^u\d{1,9}$/.test(entry.id) ? entry.id : `u${i + 1}`;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, PRESET_NAME_CHARS) : 'Preset';
    return [{ id, name, state: sanitizeState(entry.state) }];
  });
}

/** Saved settings; unreadable data is replaced with defaults, field by field. */
export function loadSettings(storage: KeyValueStorage | null): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || !isRecord(data.settings)) return { ...DEFAULT_SETTINGS };
    const { locale, project, presets } = data.settings;
    const language = isLocale(locale) ? locale : null;
    // version 1 kept the language alone
    if (data.version === 1) return { ...DEFAULT_SETTINGS, locale: language };
    if (data.version !== VERSION) return { ...DEFAULT_SETTINGS };
    return { locale: language, project: isRecord(project) ? sanitizeState(project) : null, presets: readPresets(presets) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Saves; false when the browser refuses (full storage, private mode, none at all). */
export function saveSettings(storage: KeyValueStorage | null, settings: Settings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, settings }));
    return true;
  } catch {
    return false;
  }
}

/** localStorage, or null when the browser blocks it. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
