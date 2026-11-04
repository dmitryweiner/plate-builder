// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scrollIntoContainer } from './dom';

/** A box at the given rect; a container with a scroll position of its own. */
function box(top: number, bottom: number, scrollTop = 0): HTMLElement {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: top, width: 100, height: bottom - top });
  Object.defineProperty(node, 'scrollTop', { value: scrollTop, writable: true });
  return node;
}

describe('scrollIntoContainer', () => {
  it('moves the container the least to show the target, as block: nearest', () => {
    const below = box(300, 844, 100);
    scrollIntoContainer(below, box(900, 940));
    expect(below.scrollTop).toBe(196);
    const above = box(300, 844, 100);
    scrollIntoContainer(above, box(260, 300));
    expect(above.scrollTop).toBe(60);
  });

  it('leaves a target in sight where it is', () => {
    const container = box(300, 844, 100);
    scrollIntoContainer(container, box(400, 440));
    expect(container.scrollTop).toBe(100);
  });

  it('shows the top of a target taller than the container', () => {
    const container = box(300, 400);
    scrollIntoContainer(container, box(450, 700));
    expect(container.scrollTop).toBe(150);
  });
});
