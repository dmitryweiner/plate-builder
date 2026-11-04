// Declarative controls over any state: describe how to read and write a
// value, and the rows, formatting and syncing come from here.
//
// Labels and options are message keys, not text: translation happens when
// drawn, and a change of language is just drawing again.

import type { Messages } from '../i18n';
import { make } from './dom';

/** Keys of the plain string messages. */
export type TextKey = { [K in keyof Messages]: Messages[K] extends string ? K : never }[keyof Messages];

/** A limit may depend on the state: the rounding on the plate's size. */
type Limit<T> = number | ((state: T) => number);

interface Base<T> {
  key: string;
  label: TextKey;
  /** a row that does nothing in the current state is hidden */
  when?: (state: T) => boolean;
}

export interface RangeControl<T> extends Base<T> {
  kind: 'range';
  min: Limit<T>;
  max: Limit<T>;
  step: number;
  unit?: TextKey;
  get(state: T): number;
  set(state: T, value: number): T;
}

export interface SelectControl<T> extends Base<T> {
  kind: 'select';
  /** a message key, or a text shown as it is (a font's own name) */
  options: readonly ({ value: string; label: TextKey } | { value: string; text: string })[];
  get(state: T): string;
  set(state: T, value: string): T;
}

export interface CheckControl<T> extends Base<T> {
  kind: 'check';
  get(state: T): boolean;
  set(state: T, value: boolean): T;
}

export interface TextAreaControl<T> extends Base<T> {
  kind: 'textarea';
  rows: number;
  maxLength: number;
  get(state: T): string;
  set(state: T, value: string): T;
}

export type Control<T> = RangeControl<T> | SelectControl<T> | CheckControl<T> | TextAreaControl<T>;

export interface ControlsOptions<T> {
  read: () => T;
  /**
   * A new state. `final` is false while a slider is dragged and true when an
   * edit is complete: history takes one step per final change.
   */
  change: (next: T, final: boolean) => void;
  /** ids are `<prefix>-<key>` (the number field of a range: `-n`) */
  idPrefix: string;
  t: Messages;
}

export interface ControlsHandle<T> {
  /** updates the shown values without making the DOM again */
  sync(state: T): void;
}

const limit = <T>(value: Limit<T>, state: T): number => (typeof value === 'function' ? value(state) : value);

/** As many decimals as the step has. */
function format(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return String(Number(value.toFixed(decimals)));
}

export function renderControls<T>(container: HTMLElement, controls: readonly Control<T>[], o: ControlsOptions<T>): ControlsHandle<T> {
  container.textContent = '';
  const syncers: ((state: T) => void)[] = [];

  for (const control of controls) {
    const row = make('div', 'row');
    const id = `${o.idPrefix}-${control.key}`;
    const name = make('label', 'row-name', o.t[control.label]);
    name.htmlFor = id;
    row.append(name);

    if (control.kind === 'check') {
      const box = make('input');
      box.type = 'checkbox';
      box.id = id;
      box.addEventListener('change', () => o.change(control.set(o.read(), box.checked), true));
      row.classList.add('check-row');
      row.prepend(box);
      syncers.push((state) => {
        box.checked = control.get(state);
      });
    } else if (control.kind === 'select') {
      const select = make('select');
      select.id = id;
      for (const option of control.options) {
        const node = make('option', undefined, 'text' in option ? option.text : o.t[option.label]);
        node.value = option.value;
        select.append(node);
      }
      select.addEventListener('change', () => o.change(control.set(o.read(), select.value), true));
      row.append(select);
      syncers.push((state) => {
        select.value = control.get(state);
      });
    } else if (control.kind === 'textarea') {
      const area = make('textarea');
      area.id = id;
      area.rows = control.rows;
      area.maxLength = control.maxLength;
      area.addEventListener('input', () => o.change(control.set(o.read(), area.value), false));
      area.addEventListener('change', () => o.change(control.set(o.read(), area.value), true));
      row.classList.add('text-row');
      row.append(area);
      syncers.push((state) => {
        const value = control.get(state);
        // while typing, the field is the truth: rewriting it would move the caret
        if (area.value !== value && document.activeElement !== area) area.value = value;
      });
    } else {
      const slider = make('input');
      slider.type = 'range';
      slider.id = id;
      slider.step = String(control.step);
      const field = make('input', 'exact');
      field.type = 'number';
      field.id = `${id}-n`;
      field.step = String(control.step);
      field.inputMode = 'decimal';
      field.setAttribute('aria-label', o.t[control.label]);
      const show = (state: T): void => {
        const min = String(limit(control.min, state));
        const max = String(limit(control.max, state));
        const value = format(control.get(state), control.step);
        slider.min = field.min = min;
        slider.max = field.max = max;
        slider.value = field.value = value;
      };
      slider.addEventListener('input', () => {
        field.value = format(Number(slider.value), control.step);
        o.change(control.set(o.read(), Number(slider.value)), false);
      });
      slider.addEventListener('change', () => o.change(control.set(o.read(), Number(slider.value)), true));
      field.addEventListener('change', () => {
        const typed = Number(field.value);
        const state = o.read();
        if (field.value.trim() === '' || !Number.isFinite(typed)) {
          show(state);
          return;
        }
        const value = Math.min(limit(control.max, state), Math.max(limit(control.min, state), typed));
        const next = control.set(state, value);
        o.change(next, true);
        show(o.read());
      });
      row.append(slider, field);
      if (control.unit) row.append(make('span', 'unit', o.t[control.unit]));
      syncers.push(show);
    }

    const when = control.when;
    if (when) {
      syncers.push((state) => {
        row.hidden = !when(state);
      });
    }
    container.append(row);
  }

  const handle: ControlsHandle<T> = {
    sync(state) {
      for (const syncer of syncers) syncer(state);
    },
  };
  handle.sync(o.read());
  return handle;
}
