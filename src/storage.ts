// What the app keeps in localStorage (spec §11): the language, the current
// project and the user presets, under one versioned key — a record of the
// kit's core/storage, stored as `{ version: 2, settings }` as it always was.
// Everything read is sanitised; a write that the browser refuses (quota,
// private mode) says why, so the app can say the project is not kept.

import { readUserPresets, type UserPreset as KitUserPreset } from 'maker-kit/core/presets';
import { loadRecord, saveRecord, type KeyValueStorage, type StorageWrite, type StoredRecord } from 'maker-kit/core/storage';
import { sanitizeState, type PlateState } from './geo/state';
import { isLocale, type Locale } from './i18n';

export { browserStorage, type KeyValueStorage, type StorageWrite } from 'maker-kit/core/storage';

export type UserPreset = KitUserPreset<PlateState>;

export interface Settings {
  /** The language picked in the switcher; null means detect from the browser. */
  locale: Locale | null;
  /** the project being edited; null on a first visit */
  project: PlateState | null;
  presets: UserPreset[];
}

export const STORAGE_KEY = __APP_ID__;

export const DEFAULT_SETTINGS: Settings = { locale: null, project: null, presets: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const SETTINGS: StoredRecord<Settings> = {
  key: STORAGE_KEY,
  // 2: the project and user presets joined the language (1 had the language alone)
  version: 2,
  write: (settings) => ({ settings }),
  read(data, version) {
    if (!isRecord(data) || !isRecord(data.settings)) return null;
    const { locale, project, presets } = data.settings;
    const language = isLocale(locale) ? locale : null;
    if (version === 1) return { ...DEFAULT_SETTINGS, locale: language };
    if (version !== 2) return null;
    return {
      locale: language,
      project: isRecord(project) ? sanitizeState(project) : null,
      presets: readUserPresets(presets, sanitizeState),
    };
  },
};

/** Saved settings; unreadable data is replaced with defaults, field by field. */
export function loadSettings(storage: KeyValueStorage | null): Settings {
  return loadRecord(storage, SETTINGS) ?? { ...DEFAULT_SETTINGS };
}

/** Saves; `full` or `blocked` when the browser refuses (full storage; private mode or none at all). */
export function saveSettings(storage: KeyValueStorage | null, settings: Settings): StorageWrite {
  return saveRecord(storage, SETTINGS, settings);
}
