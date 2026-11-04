// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { messages } from '../i18n';
import { renderControls, type Control } from './controls';

interface Demo {
  kind: string;
  size: number;
  on: boolean;
}

const controls: Control<Demo>[] = [
  {
    kind: 'select',
    key: 'kind',
    label: 'outline',
    options: [
      { value: 'a', label: 'kindRectangle' },
      { value: 'b', label: 'kindStar' },
    ],
    get: (s) => s.kind,
    set: (s, kind) => ({ ...s, kind }),
  },
  {
    kind: 'range',
    key: 'size',
    label: 'width',
    min: 10,
    max: (s) => (s.on ? 300 : 100),
    step: 0.5,
    unit: 'mm',
    get: (s) => s.size,
    set: (s, size) => ({ ...s, size }),
  },
  { kind: 'check', key: 'on', label: 'points', when: (s) => s.kind === 'b', get: (s) => s.on, set: (s, on) => ({ ...s, on }) },
];

let state: Demo;
let changes: { next: Demo; final: boolean }[];

function render(locale: 'en' | 'ru' = 'en') {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = renderControls(container, controls, {
    read: () => state,
    change: (next, final) => {
      state = next;
      changes.push({ next, final });
    },
    idPrefix: 'demo',
    t: messages[locale],
  });
  return { container, handle };
}

function input(id: string): HTMLInputElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(id);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '';
  state = { kind: 'a', size: 50, on: false };
  changes = [];
});

describe('renderControls', () => {
  it('labels every row in the given language and translates the options', () => {
    const { container } = render('ru');
    expect([...container.querySelectorAll('.row-name')].map((n) => n.textContent)).toEqual(['Контур', 'Ширина', 'Лучи']);
    expect([...container.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Прямоугольник', 'Звезда']);
    expect(container.querySelector('.unit')?.textContent).toBe('мм');
  });

  it('shows a range as a slider and an exact number, both with the limits of the state', () => {
    render();
    expect([input('demo-size').value, input('demo-size-n').value]).toEqual(['50', '50']);
    expect([input('demo-size').min, input('demo-size').max, input('demo-size-n').max]).toEqual(['10', '100', '100']);
  });

  it('reports a slider drag as it goes and once more when it ends', () => {
    render();
    const slider = input('demo-size');
    slider.value = '60';
    slider.dispatchEvent(new Event('input'));
    slider.value = '70';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
    expect(changes.map((c) => [c.next.size, c.final])).toEqual([
      [60, false],
      [70, false],
      [70, true],
    ]);
    expect(input('demo-size-n').value).toBe('70');
  });

  it('takes a typed number on change, clamped to the limits', () => {
    render();
    const field = input('demo-size-n');
    field.value = '1000';
    field.dispatchEvent(new Event('change'));
    expect(state.size).toBe(100);
    expect(changes.at(-1)?.final).toBe(true);
    field.value = 'abc';
    field.dispatchEvent(new Event('change'));
    expect(state.size).toBe(100);
    expect(field.value).toBe('100');
  });

  it('hides a row that does nothing in the current state and syncs it back', () => {
    const { container, handle } = render();
    const row = input('demo-on').closest('.row');
    expect(row instanceof HTMLElement && row.hidden).toBe(true);
    const select = container.querySelector('select');
    if (!select) throw new Error('no select');
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    handle.sync(state);
    expect(row instanceof HTMLElement && row.hidden).toBe(false);
    expect(input('demo-size').max).toBe('100');
    input('demo-on').click();
    handle.sync(state);
    expect(state.on).toBe(true);
    expect(input('demo-size').max).toBe('300');
  });
});
