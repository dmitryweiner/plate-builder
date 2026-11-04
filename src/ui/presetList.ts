// The presets in the Export card (spec §11): the built-in ones by their
// names, the user's with a name field (rename on change) and delete. The one
// opened last says "changed" once the project differs from it.

import type { Locale, Messages } from '../i18n';
import type { BuiltInPreset } from '../state/presets';
import type { UserPreset } from '../storage';
import { make } from './dom';

export interface PresetActions {
  open(id: string): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
}

function row(id: string): HTMLLIElement {
  const item = make('li', 'preset-row');
  item.dataset.id = id;
  return item;
}

export function renderPresetList(
  list: HTMLElement,
  builtIn: readonly BuiltInPreset[],
  user: readonly UserPreset[],
  changed: string | null,
  t: Messages,
  locale: Locale,
  actions: PresetActions,
): void {
  list.textContent = '';
  const mark = (id: string) => (id === changed ? [make('span', 'preset-changed', t.presetChanged)] : []);
  for (const preset of builtIn) {
    const item = row(preset.id);
    const open = make('button', 'element-name', preset.names[locale]);
    open.type = 'button';
    open.addEventListener('click', () => actions.open(preset.id));
    item.append(open, ...mark(preset.id));
    list.append(item);
  }
  for (const preset of user) {
    const item = row(preset.id);
    const name = make('input', 'name-field');
    name.type = 'text';
    name.value = preset.name;
    name.maxLength = 60;
    name.setAttribute('aria-label', t.presetName);
    name.addEventListener('change', () => actions.rename(preset.id, name.value));
    const open = make('button', 'link-button', t.openPreset);
    open.type = 'button';
    open.addEventListener('click', () => actions.open(preset.id));
    const remove = make('button', 'icon-button', '✕');
    remove.type = 'button';
    remove.title = t.remove;
    remove.setAttribute('aria-label', `${t.remove}: ${preset.name}`);
    remove.addEventListener('click', () => actions.remove(preset.id));
    item.append(name, ...mark(preset.id), open, remove);
    list.append(item);
  }
}
