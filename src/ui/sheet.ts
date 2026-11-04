// The panel as a bottom sheet on a phone (spec §7.1), as in cast-builder:
// the view fills the screen and the sheet lies over its lower part. The app
// opens it when an element is selected (to edit it) and closes it on a tap
// on empty space; its own button brings it back. On a wide screen the panel
// stands beside the view: the CSS ignores `.open` there and the button stays
// hidden.

/** The part of `MediaQueryList` used here; a test passes its own. */
export interface NarrowQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

export interface SheetOptions {
  panel: HTMLElement;
  /** opens the closed sheet */
  button: HTMLButtonElement;
  /** closes it, from inside */
  close: HTMLButtonElement;
  /** true where the panel is a sheet */
  narrow: NarrowQuery;
  /** whether it starts open (it does by default) */
  open?: boolean;
  /** after it opens or closes */
  onChange?: () => void;
}

export interface SheetHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function setupSheet({ panel, button, close, narrow, open: initial = true, onChange }: SheetOptions): SheetHandle {
  let open = initial;
  const apply = (): void => {
    panel.classList.toggle('open', open);
    button.hidden = open || !narrow.matches;
  };
  const set = (next: boolean) => {
    if (next === open) return;
    open = next;
    apply();
    onChange?.();
  };
  button.addEventListener('click', () => set(true));
  close.addEventListener('click', () => set(false));
  narrow.addEventListener('change', apply);
  apply();
  return { open: () => set(true), close: () => set(false), isOpen: () => open };
}
