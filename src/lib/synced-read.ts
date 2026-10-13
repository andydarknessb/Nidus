import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ChangeFeedContext, useRefetchOn } from './change-feed';
import type { WatchedTable } from './realtime';
import { keepIfSame } from './same-data';
import { createCardWrite, type CardWriteOutcome, type CardWriteThen, type FailWords } from './card-write';
import { isRefusal, writeFailureWords } from './write-failure';

// The synced read (spec 0008): how every screen reads from the server, keeps up with the change
// feed, and shows its own writes before the server answers. One rule set for every screen:
//
// - It reads at once, on a change notice, 30 seconds after a read lands and 5 seconds after one
//   fails. Change notices while a read is in flight become exactly one more read.
// - The screen's own writes win. No read lands while a write is in flight or over one that began
//   or ended after the read started; one read follows the last write, worked or not, so a change
//   from another device that arrived meanwhile is shown too.
// - What is shown is the last read plus each pending change, in order. A change is a pure function
//   of what is shown. A failed write takes back only its own change; a saved one stays shown until
//   the read after it lands, and that read replaces everything.
// - A failed read keeps what is shown. `state` is where the read is: 'loading' until something has
//   landed, 'failed' when the first read did not (the only time a screen says it could not load),
//   else 'ready'. `failed` is the flag beside it: ready, but the last read failed (the header's
//   lost-connection line). `error` is what the last read failed with, for a screen whose words
//   depend on it.
// - A one-shot action on a card (spec 0011, 0012) is a `change`: the card write guard (card-write.ts), then the write, then the
//   read-back when there is a read, so the card shows what the server holds; and when it did not go through, it says so in the
//   place the person is looking (`useChange`, below).

export const REFRESH_MS = 30_000;
export const RETRY_MS = 5_000;

export type ReadStateName = 'loading' | 'failed' | 'ready';
export type SyncedState<T> = { data: T | null; state: ReadStateName; failed: boolean; error: unknown };

export interface SyncedRead<T> {
  // A change notice: read now, or once more after the read in flight. Waits for writes in flight.
  poke(): void;
  // Runs `work`, with `change` shown until it fails or the read after it lands, and what `landed` makes of its result from when it
  // lands until that read (none, when it gives nothing). Rejects as `work` does. A card's `change` gives `landed` as its `meanwhile`.
  write<R>(work: () => Promise<R>, change?: (shown: T) => T, landed?: (result: R) => ((shown: T) => T) | undefined): Promise<R>;
  // Settles once a read begun after every write so far has settled, worked or not: a form that closes on a save reads it back first.
  readBack(): Promise<void>;
  // Nothing is shown or read after this.
  stop(): void;
}

export function startSyncedRead<T>(options: { load: () => Promise<T>; onChange: (state: SyncedState<T>) => void }): SyncedRead<T> {
  const { load, onChange } = options;
  let live = true;
  let read: T | null = null;
  let error: unknown = null;
  let pending: { change: (shown: T) => T }[] = [];
  let writes = 0;
  // Counts reads started and writes begun or ended: a read from before the latest of either is stale.
  let epoch = 0;
  let reading = false;
  let poked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let said: SyncedState<T> | null = null;
  // Who is waiting on readBack: told when a read that was not stale settles.
  let waiting: (() => void)[] = [];

  const notify = () => {
    const data = read === null ? null : pending.reduce<T>((shown, entry) => entry.change(shown), read);
    const failed = error !== null;
    const state: SyncedState<T> = { data, state: read !== null ? 'ready' : failed ? 'failed' : 'loading', failed, error };
    // A read that fails again, or finds what is shown, says nothing new: an offline screen is not drawn again every few seconds.
    if (said && said.data === state.data && said.failed === state.failed) return;
    said = state;
    onChange(state);
  };

  const run = async () => {
    clearTimeout(timer);
    reading = true;
    poked = false;
    const started = ++epoch;
    let delay = REFRESH_MS;
    try {
      const value = await load();
      if (live && epoch === started && writes === 0) {
        read = keepIfSame(read, value);
        pending = [];
        error = null;
        notify();
      }
    } catch (failure) {
      delay = RETRY_MS;
      if (live && epoch === started) {
        // Never null, so a read that failed is told from one that did not.
        error = failure ?? new Error('read failed');
        notify();
      }
    }
    reading = false;
    // No write began or ended while it ran (a write in flight makes epoch move when it ends): a read back.
    if (epoch === started && writes === 0) {
      const told = waiting;
      waiting = [];
      for (const tell of told) tell();
    }
    if (!live || writes > 0) return;
    if (poked) void run();
    else timer = setTimeout(() => void run(), delay);
  };

  const poke = () => {
    if (!live || writes > 0) return;
    if (reading) poked = true;
    else void run();
  };

  void run();
  return {
    poke,
    async write(work, change, landed) {
      writes += 1;
      epoch += 1;
      const entry = change ? { change } : null;
      if (entry) {
        pending = [...pending, entry];
        notify();
      }
      try {
        const result = await work();
        const after = landed?.(result);
        if (after) {
          pending = [...pending, { change: after }];
          notify();
        }
        return result;
      } catch (error) {
        if (entry) {
          pending = pending.filter((other) => other !== entry);
          notify();
        }
        throw error;
      } finally {
        writes -= 1;
        epoch += 1;
        poke();
      }
    },
    readBack() {
      return new Promise<void>((resolve) => {
        if (!live) return resolve();
        waiting.push(resolve);
        // In flight with no write since it began, it counts; with writes in flight, the read after the last one will.
        if (!reading && writes === 0) void run();
      });
    },
    stop() {
      live = false;
      clearTimeout(timer);
      for (const tell of waiting) tell();
      waiting = [];
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

// The change of a card (spec 0012): the card write guard (card-write.ts), then the write, then the read-back when there is a read, and
// the words of a write that did not go through. Plain TypeScript, so a test needs no screen; `useChange` is its hook. `read` is asked
// for at each change (a screen's read may be made again); `offline` is asked when a write fails, which decides what it says: read
// when it fails, not when it was made.
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

// The change of a card, with its focus and its `aria-disabled` state: `busy` is as of the last draw, `isBusy()` is now. The card draws
// `aria-disabled={busy || undefined}`, never `disabled`. `problem(place)` is what a write said there. With a `read` the change is read
// back; without (a lone write: the Household's name, the Appearance, the weather, joining) it is only written. `useSyncedRead` hands
// one on for its read; a card with a second action that must not wait on the first makes another of its own with `useChange(read)`.
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

// "Could not load routines. Check your connection.": what a screen says when its read has failed with nothing loaded. A ladder is drawn
// by the ReadState part (components/ReadState.tsx); the Settings cards' own lost-connection line (a read that failed over what was
// read) and the words a lib keeps for a failed read use this too.
export function couldNotLoad(what: string): string {
  return `Could not load ${what}. Check your connection.`;
}

// The React side: reads with `load` while `key` stays the same (null reads nothing), and again from the
// start when it changes. A new key starts with nothing shown, unless `keepAcrossKeys`: then what was
// shown stays until the new key's first read lands (today's Routines over Household midnight). `tables`
// should be a constant, as useRefetchOn asks.
const NOTHING: SyncedState<never> = { data: null, state: 'loading', failed: false, error: null };

// The card's change (`useChange`) comes with it: `change`, `problem`, `say`, `fail`, `clear`, `busy`, `isBusy`, `focus`.
export function useSyncedRead<T>(
  load: () => Promise<T>,
  tables: readonly WatchedTable[],
  key: string | null,
  { keepAcrossKeys = false }: { keepAcrossKeys?: boolean } = {},
): SyncedState<T> & Pick<SyncedRead<T>, 'write' | 'readBack'> & { refresh: () => void } & ReturnType<typeof useChange<T>> {
  const [state, setState] = useState<SyncedState<T>>(NOTHING);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const current = useRef<SyncedRead<T> | null>(null);
  useEffect(() => {
    if (!keepAcrossKeys) setState(NOTHING);
    if (key === null) return;
    // Kept across keys, a new key's read that fails before anything lands keeps what the old key showed.
    const onChange = (next: SyncedState<T>) =>
      setState((was) => (keepAcrossKeys && next.data === null && was.data !== null ? { ...next, data: was.data, state: 'ready' } : next));
    const started = startSyncedRead<T>({ load: () => latest.current(), onChange });
    current.current = started;
    return () => {
      started.stop();
      current.current = null;
    };
    // keepAcrossKeys is how a screen reads, not what it reads: it never changes for one caller.
  }, [key]);
  useRefetchOn(tables, () => current.current?.poke());
  const write = useCallback<SyncedRead<T>['write']>((work, change, landed) => (current.current ? current.current.write(work, change, landed) : work()), []);
  const refresh = useCallback(() => current.current?.poke(), []);
  const readBack = useCallback(() => current.current?.readBack() ?? Promise.resolve(), []);
  // The card's one-at-a-time guard, with its write and read-back: `change`, `problem`, `say`, `fail`, `clear`, `busy`, `isBusy`, `focus`.
  const guard = useChange<T>({ write, readBack });
  return { ...state, write, refresh, readBack, ...guard };
}
