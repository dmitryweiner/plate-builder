// What maker-kit's ui/dom lacks: el and make are the kit's.

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
