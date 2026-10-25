import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ChangeFeedContext } from './change-feed';
import type { SyncedRead } from './synced-read';
import { isRefusal, writeFailureWords } from './write-failure';

// The change (spec 0014): how a screen changes the Household's data, one at a time, and what it says when the change did not go
// through. One interface for every write: the guard (once the card write guard, spec 0008), the write, the read-back when the
// screen has a read, the places a failure is said at, and the words. Plain TypeScript, so a test needs no screen; `useChange` is
// its hook, and `useSyncedRead` hands one on for its read. A screen that only writes (the Household's name, the Appearance, the
// weather, joining, the Meal sheet) calls `useChange()` with no read.
//
// A page does not keep a page-wide failure string: every action names a place, and an action with no row of its own names the
// page's line. ADR 0006 records it.

// What a failed change may be worded with: the words for a value the database refused, and for an action that is not a save.
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
  // What the card does with a failure, before the guard is let go: it says so in the change's words (synced-read.ts).
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

// The guard, internal to the change: one action at a time, let go on every way out.
function createCardWrite(): CardWrite {
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

// A write that did not go through, with where it was made. It is said at once, in the place the person is looking (inside the open
// form, under the row that failed), and it stays there until that place is written again, closed, or the person answers the
// question: reading the screen again never clears it, since a read that succeeds says nothing of whether a write did. A trouble
// reading is its own thing, and a section keeps it apart. Each place has its own, so two rows that both failed both say so. `n`
// counts what has been said, so that a retry that fails again is a new alert, heard again, though its words are the same.
export type WriteProblem = { place: string; words: string; n: number; refused: boolean };

// What a change may say of itself: in whose words a failure is said when they are not the default two (`words`); `failed` may word it
// itself (return true when it did); `landed` is what the card does once the work landed and was read back, and the id it returns is
// where focus goes; `meanwhile` is what is shown from the work's result until the read that follows it lands (`write`'s `landed`).
export type ChangeThen<R, T> = {
  words?: FailWords;
  failed?: ((error: unknown) => boolean | void) | undefined;
  landed?: CardWriteThen<R>['landed'];
  meanwhile?: ((result: R) => ((shown: T) => T) | undefined) | undefined;
};

export type ChangeState = { busy: boolean; focus: string | null; problems: Readonly<Record<string, WriteProblem>> };

// The change of a screen (specs 0012 and 0014): the guard, then the write, then the read-back when there is a read, and the words of
// a write that did not go through. Plain TypeScript, so a test needs no screen; `useChange` is its hook. `read` is asked for at each
// change (a screen's read may be made again); `offline` is asked when a write fails, which decides what it says: read when it fails,
// not when it was made.
export function createChange<T = never>(options: { read?: () => Pick<SyncedRead<T>, 'write' | 'readBack'> | undefined; offline?: () => boolean } = {}) {
  const card = createCardWrite();
  let problems: Record<string, WriteProblem> = {};
  let said = 0;
  let snapshot: ChangeState = { ...card.state(), problems };
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  card.subscribe(tell);

  const state = (): ChangeState => {
    const now = card.state();
    if (snapshot.busy !== now.busy || snapshot.focus !== now.focus || snapshot.problems !== problems) snapshot = { ...now, problems };
    return snapshot;
  };

  const put = (place: string, words: string, refused: boolean) => {
    said += 1;
    problems = { ...problems, [place]: { place, words, refused, n: said } };
    tell();
  };
  // A sentence the caller has chosen itself (a code the server said is not valid), `refused` when it is about a field.
  const say = (place: string, words: string, refused = false) => put(place, words, refused);
  const fail = (place: string, error: unknown, words: FailWords = {}) =>
    put(place, writeFailureWords(error, { offline: options.offline?.() ?? false, refusal: words.refusal, said: words.said }), words.refusal !== undefined && isRefusal(error));
  // Takes away what was said in `place`, or everywhere when no place is named: a write that landed takes away its own failure, and
  // opening or closing a form takes away what another one said. Nothing is taken away when a retry starts: the words stay until
  // there is an answer, so that the screen does not move under the finger that is pressing.
  const clear = (place?: string) => {
    if (place === undefined ? Object.keys(problems).length === 0 : !(place in problems)) return;
    if (place === undefined) problems = {};
    else {
      problems = { ...problems };
      delete problems[place];
    }
    tell();
  };

  // Nothing is done when the guard is held (`busy`). Otherwise `work` is written (through the read when there is one: a failure is
  // `failed`, said before the guard is let go, and the read that follows the write still comes) and, once it landed, `place` is
  // cleared and the read is waited for before `landed` and the guard's release, so what the card then shows is what the server
  // holds. A failure is `then.failed`'s to word, else said at `place` (`null`: the card says nothing of it, and `work` clears
  // nothing). Never throws for `work`.
  const change = <R>(place: string | null, work: () => Promise<R>, then: ChangeThen<R, T> = {}): Promise<CardWriteOutcome> => {
    const read = options.read?.();
    const written = async () => {
      const result = await work();
      if (place !== null) clear(place);
      return result;
    };
    return card.run(
      async () => {
        if (!read) return written();
        const result = await read.write(written, undefined, then.meanwhile);
        await read.readBack();
        return result;
      },
      {
        landed: then.landed,
        failed: (error) => {
          if (then.failed?.(error) === true) return;
          if (place !== null) fail(place, error, then.words);
        },
      },
    );
  };

  return {
    state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    change,
    say,
    fail,
    clear,
    // Sends focus to the control `id`, for a card that moves it with no write (Cancel, a form closing).
    focus: card.focus,
    focused: card.focused,
    isBusy: () => card.state().busy,
  };
}

// The change of a screen, with its focus and its `aria-disabled` state: `busy` is as of the last draw, `isBusy()` is now. The card
// draws `aria-disabled={busy || undefined}`, never `disabled`. `problem(place)` is what a write said there. With a `read` the change
// is read back; without (a lone write: the Household's name, the Appearance, the weather, joining, the Meal sheet) it is only
// written. `useSyncedRead` hands one on for its read; a card with a second action that must not wait on the first makes another of
// its own with `useChange(read)`.
export function useChange<T = never>(read?: Pick<SyncedRead<T>, 'write' | 'readBack'>) {
  // The read and the feed as of the last draw; the feed's status is asked when a write fails, so a connection change draws nothing.
  const feed = useContext(ChangeFeedContext);
  const latest = useRef({ read, feed });
  useEffect(() => {
    latest.current = { read, feed };
  });
  const [core] = useState(() => createChange<T>({ read: () => latest.current.read, offline: () => latest.current.feed?.status() === 'offline' }));
  const [state, setState] = useState(core.state);
  useEffect(() => {
    setState(core.state());
    return core.subscribe(() => setState(core.state()));
  }, [core]);
  // Moves focus once the control it names is on screen (the swap unmounts whatever had it).
  useEffect(() => {
    if (state.focus === null) return;
    document.getElementById(state.focus)?.focus();
    core.focused();
  }, [core, state.focus]);

  const { problems } = state;
  const problem = useCallback((place: string): WriteProblem | null => problems[place] ?? null, [problems]);
  return { busy: state.busy, problem, change: core.change, say: core.say, fail: core.fail, clear: core.clear, focus: core.focus, isBusy: core.isBusy };
}
