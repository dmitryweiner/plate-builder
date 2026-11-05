import { describe, expect, it } from 'vitest';
import { defaultHole, defaultState, sanitizeState } from './geo/state';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, STORAGE_KEY, type KeyValueStorage, type Settings } from './storage';

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

/** A storage that is full: reading works, writing throws as a quota error does. */
class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException('quota', 'QuotaExceededError');
  }
}

const broken: KeyValueStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

const project = () => sanitizeState({ ...defaultState(), name: 'door', holes: [defaultHole('round')] });

describe('settings storage', () => {
  it('uses the package name as the key', () => {
    expect(STORAGE_KEY).toBe('plate-builder');
  });

  it('returns defaults when nothing is saved or storage is unavailable', () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips the language, the project and the user presets', () => {
    const storage = new MemoryStorage();
    const settings: Settings = { locale: 'uk', project: project(), presets: [{ id: 'u1', name: 'Mine', state: project() }] };
    expect(saveSettings(storage, settings)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('says when it could not save: quota, private mode, no storage', () => {
    expect(saveSettings(new FullStorage(), DEFAULT_SETTINGS)).toBe(false);
    expect(saveSettings(broken, DEFAULT_SETTINGS)).toBe(false);
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
  });

  it.each(['not json', '[]', '{"version":9,"settings":{"locale":"ru"}}', '{"version":2}'])('resets unreadable data: %s', (raw) => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, raw);
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the language of a version 1 save', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, settings: { locale: 'he', count: 3 } }));
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, locale: 'he' });
  });

  it('opens a version 2 save from before the magnets with none, the rest kept', () => {
    const storage = new MemoryStorage();
    const strip = (state: ReturnType<typeof project>) => {
      const old: Record<string, unknown> = { ...state };
      delete old.magnets;
      return old;
    };
    const raw = {
      version: 2,
      settings: { locale: 'ru', project: strip(project()), presets: [{ id: 'u1', name: 'Mine', state: strip(project()) }] },
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(loadSettings(storage)).toEqual({ locale: 'ru', project: project(), presets: [{ id: 'u1', name: 'Mine', state: project() }] });
    expect(project().magnets.count).toBe(0);
  });

  it('opens a save from before the edges with sharp ones, the rest kept', () => {
    const storage = new MemoryStorage();
    const strip = (state: ReturnType<typeof project>) => {
      const plate: Record<string, unknown> = { ...state.plate };
      delete plate.edgeSize;
      delete plate.edgeProfile;
      return { ...state, plate };
    };
    const edged = { ...project(), plate: { ...project().plate, edgeSize: 0, edgeProfile: 'fillet' as const } };
    const raw = {
      version: 2,
      settings: { locale: 'uk', project: strip(project()), presets: [{ id: 'u1', name: 'Mine', state: strip(project()) }] },
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(loadSettings(storage)).toEqual({ locale: 'uk', project: edged, presets: [{ id: 'u1', name: 'Mine', state: edged }] });
  });

  it('sanitises what it reads, field by field', () => {
    const storage = new MemoryStorage();
    const raw = {
      version: 2,
      settings: { locale: 'xx', project: { plate: { width: 1e6 } }, presets: [{ id: 'u1', name: '', state: {} }, 'junk', { id: 7 }] },
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const loaded = loadSettings(storage);
    expect(loaded.locale).toBeNull();
    expect(loaded.project?.plate.width).toBe(300);
    expect(loaded.presets).toEqual([{ id: 'u1', name: 'Preset', state: defaultState() }]);
  });
});
