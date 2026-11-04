// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { setupSheet, type NarrowQuery } from './sheet';

/** A media query the test switches by hand. */
function query(initial: boolean): NarrowQuery & { set(next: boolean): void } {
  const listeners: (() => void)[] = [];
  let matches = initial;
  return {
    get matches() {
      return matches;
    },
    addEventListener: (_type, listener) => listeners.push(listener),
    set(next) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

let panel: HTMLElement;
let button: HTMLButtonElement;
let close: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="panel"></div><button id="open"></button><button id="close"></button>';
  panel = document.querySelector('#panel') ?? document.createElement('div');
  button = document.querySelector<HTMLButtonElement>('#open') ?? document.createElement('button');
  close = document.querySelector<HTMLButtonElement>('#close') ?? document.createElement('button');
});

describe('setupSheet', () => {
  it('starts open on a phone; its button shows only while it is closed', () => {
    const sheet = setupSheet({ panel, button, close, narrow: query(true) });
    expect(panel.classList.contains('open')).toBe(true);
    expect(button.hidden).toBe(true);
    close.click();
    expect(sheet.isOpen()).toBe(false);
    expect(panel.classList.contains('open')).toBe(false);
    expect(button.hidden).toBe(false);
    button.click();
    expect(sheet.isOpen()).toBe(true);
  });

  it('does nothing on a wide screen, where the panel stands beside the view', () => {
    const narrow = query(false);
    const sheet = setupSheet({ panel, button, close, narrow });
    sheet.close();
    expect(button.hidden).toBe(true);
    narrow.set(true);
    expect(button.hidden).toBe(false);
  });

  it('opens and closes on request', () => {
    const sheet = setupSheet({ panel, button, close, narrow: query(true), open: false });
    expect(sheet.isOpen()).toBe(false);
    sheet.open();
    expect(panel.classList.contains('open')).toBe(true);
  });

  it('tells when it opens or closes, and not when nothing changes', () => {
    let changes = 0;
    const sheet = setupSheet({ panel, button, close, narrow: query(true), onChange: () => changes++ });
    sheet.open();
    expect(changes).toBe(0);
    sheet.close();
    button.click();
    expect(changes).toBe(2);
  });
});
