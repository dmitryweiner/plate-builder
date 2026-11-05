// Typed DOM access without `as` casts.

export function el<T extends Element>(id: string, ctor: abstract new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof ctor)) throw new Error(`#${id} is not ${ctor.name}`);
  return node;
}

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Scrolls `container`, and nothing around it, the least that shows `target`
 * — as `scrollIntoView({ block: 'nearest' })`, which also scrolls the page:
 * a phone's closed sheet lies below the window, and the page jumped.
 * Whole pixels, rounded up: Chrome drops a fraction of one, and the target
 * stuck out by it.
 */
export function scrollIntoContainer(container: HTMLElement, target: Element): void {
  const view = container.getBoundingClientRect();
  const item = target.getBoundingClientRect();
  if (item.top < view.top) container.scrollTop -= Math.ceil(view.top - item.top);
  else if (item.bottom > view.bottom) container.scrollTop += Math.ceil(Math.min(item.bottom - view.bottom, item.top - view.top));
}
