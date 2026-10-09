// The card write guard (spec 0008): how a one-shot action on a Settings card (pair, unpair, remove, invite, add, send a test, save or
// delete a person, a change on the Routines and Lists pages) is done one at a time. A press while one is on its way does nothing;
// the guard is let go on every exit, a throw included; and the card says where focus goes once the action has landed. Choices that
// stack up (a calendar's switch, a tick, a list item) are not one-shot actions and do not come through here: they are pending
// changes on the synced read. The state holder is plain TypeScript, as the status line is, so a test needs no screen. It is the
// synced read's own, behind `read.change` (synced-read.ts: the guard, then the write, then the read-back), which wires it to a card
// and draws `aria-disabled` from `busy`, never `disabled`: a button that is disabled while it has focus drops it to the page.

// What a write-problem failure may be worded with: the words for a value the database refused, and for an action that is not a save.
export type FailWords = { refusal?: string; said?: { failed: string; offline: string } } | undefined;

export type CardWriteState = {
  // Whether an action is on its way.
  busy: boolean;
  // The id of the control focus is to go to once it is on screen, or null. A new object is made at each change.
  focus: string | null;
};

// What a press came to: `busy` (nothing was done), `done` (the work landed) or `failed` (the work threw, and `failed` heard of it).
export type CardWriteOutcome = 'busy' | 'done' | 'failed';

export type CardWriteThen<T> = {
  // What the card does once the work landed, before the guard is let go (so a draw never sees the guard free with this undone).
  // The id it returns is where focus goes. It may be a card's own state changes; if it throws, the guard is let go and the error
  // goes on to the caller.
  landed?: ((value: T) => string | null | undefined | void) | undefined;
  // What the card does with a failure, before the guard is let go: it says so in the write-problem words (use-write-problem).
  failed?: ((error: unknown) => void) | undefined;
};

export type CardWrite = {
  state(): CardWriteState;
  // Runs `work` unless one is already on its way. Never throws for `work`; a throw there is a `failed` outcome.
  run<T>(work: () => Promise<T>, then?: CardWriteThen<T>): Promise<CardWriteOutcome>;
  // Sends focus to the control `id`, for a card that moves it with no write (Cancel, a form closing).
  focus(id: string): void;
  // The card has moved focus; it is not to be moved again.
  focused(): void;
  // Calls `listener` after each change. Returns the function that stops it.
  subscribe(listener: () => void): () => void;
};

export function createCardWrite(): CardWrite {
  let state: CardWriteState = { busy: false, focus: null };
  const listeners = new Set<() => void>();

  const set = (next: Partial<CardWriteState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  return {
    state: () => state,
    async run(work, then = {}) {
      // The guard is this flag, set before anything is awaited: two presses in the same moment cannot both get past it.
      if (state.busy) return 'busy';
      set({ busy: true });
      let focus: string | null = null;
      // Let go on every way out: landing, a failure, and the card's own code throwing.
      try {
        let value: Awaited<ReturnType<typeof work>>;
        try {
          value = await work();
        } catch (error) {
          then.failed?.(error);
          return 'failed';
        }
        focus = then.landed?.(value) ?? null;
        return 'done';
      } finally {
        set(focus === null ? { busy: false } : { busy: false, focus });
      }
    },
    focus: (id) => set({ focus: id }),
    focused: () => set({ focus: null }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Where a failure goes: to the card first, which may word it itself (returns true when it did); otherwise to the write-problem words
// (`fail`, useWriteProblem's), at `place` and only when the card named one.
export function sayFailure(
  error: unknown,
  action: { place?: string | undefined; words?: FailWords | undefined; failed?: ((error: unknown) => boolean | void) | undefined },
  fail?: (place: string, error: unknown, words?: FailWords) => void,
): void {
  if (action.failed?.(error) === true) return;
  if (fail && action.place !== undefined) fail(action.place, error, action.words);
}
