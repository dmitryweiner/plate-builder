// Undo and redo over the whole state (spec §11). A gesture — a drag, a
// slider moved end to end — is one step: its frames are shown with `live`
// and recorded once by `commit`, from the state before the gesture began.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;
  /** the state before the gesture in progress; null when none is */
  private base: T | null = null;

  constructor(
    initial: T,
    private readonly limit = 100,
  ) {
    this.current = initial;
  }

  get state(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0 && this.base === null;
  }

  /** A frame of a gesture: shown, not yet a step. */
  live(state: T): void {
    this.base ??= this.current;
    this.current = state;
  }

  /** The end of an edit: one step from the state before it. A step that changes nothing is not recorded. */
  commit(state: T): void {
    const from = this.base ?? this.current;
    this.base = null;
    this.current = state;
    if (equal(from, state)) return;
    this.past.push(from);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(): T | null {
    // a gesture in progress is cancelled: undo goes back to before it
    if (this.base !== null) {
      this.current = this.base;
      this.base = null;
      return this.current;
    }
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.current);
    this.current = previous;
    return previous;
  }

  redo(): T | null {
    if (this.base !== null) return null;
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  /** A new project: no steps either way. */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.base = null;
    this.current = state;
  }
}

/** States are plain JSON data; a deep comparison by their text is exact and cheap enough per step. */
function equal(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
