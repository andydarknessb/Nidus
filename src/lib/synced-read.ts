import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRefetchOn } from './change-feed';
import type { WatchedTable } from './realtime';
import { keepIfSame } from './same-data';
import { createCardWrite, sayFailure, type CardWrite, type CardWriteOutcome, type CardWriteThen, type FailWords } from './card-write';
import type { useWriteProblem } from './use-write-problem';

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
// - A one-shot action on a card (spec 0011) is a `change`: the card write guard (card-write.ts),
//   then the write, then the read-back, so the card shows what the server holds.

export const REFRESH_MS = 30_000;
export const RETRY_MS = 5_000;

export type ReadStateName = 'loading' | 'failed' | 'ready';
export type SyncedState<T> = { data: T | null; state: ReadStateName; failed: boolean; error: unknown };

export interface SyncedRead<T> {
  // A change notice: read now, or once more after the read in flight. Waits for writes in flight.
  poke(): void;
  // Runs `work`, showing `change` until it fails or the read after it lands, and what `landed` makes of its result from when it
  // lands until that read (none, when it gives nothing). Rejects as `work` does.
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

export type ChangeThen<R, T> = CardWriteThen<R> & {
  // What is shown from the write's result until the read that follows it lands (`write`'s `landed`).
  showing?: ((result: R) => ((shown: T) => T) | undefined) | undefined;
};

// The change on `read` behind `card`: nothing is done when the guard is held (`busy`); otherwise `work` is written through the read
// (a failure is `failed`, said before the guard is let go, and the read that follows the write still comes) and, once it landed, read
// back before `landed` and the guard's release, so what the card then shows is what the server holds. Never throws for `work`.
export function changeThrough<T>(read: Pick<SyncedRead<T>, 'write' | 'readBack'>, card: CardWrite) {
  return <R>(work: () => Promise<R>, then: ChangeThen<R, T> = {}): Promise<CardWriteOutcome> =>
    card.run(
      async () => {
        const result = await read.write(work, undefined, then.showing);
        await read.readBack();
        return result;
      },
      then,
    );
}

// What a change may say of itself on a card: where a failure says so (useWriteProblem's place) and in whose words when they are not
// the default two; `failed` may word it itself (return true when it did); `landed`'s id is where focus goes.
export type CardAction<R, T> = Omit<ChangeThen<R, T>, 'failed'> & {
  place?: string | undefined;
  words?: FailWords | undefined;
  failed?: ((error: unknown) => boolean | void) | undefined;
};

// The guard on a card, with its focus and its `aria-disabled` state: `busy` is as of the last draw, `isBusy()` is now. The card draws
// `aria-disabled={busy || undefined}`, never `disabled`. `useSyncedRead` hands one on as `read.change`; a card with a second action that
// must not wait on the first makes another of its own with `useChange(read)`.
export function useChange<T>(read: Pick<SyncedRead<T>, 'write' | 'readBack'>, problems?: Pick<ReturnType<typeof useWriteProblem>, 'fail'>) {
  const [core] = useState(createCardWrite);
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

  const fail = problems?.fail;
  const { write, readBack } = read;
  const through = useMemo(() => changeThrough<T>({ write, readBack }, core), [core, write, readBack]);
  const change = useCallback(
    <R>(work: () => Promise<R>, action: CardAction<R, T> = {}): Promise<CardWriteOutcome> =>
      through(work, { landed: action.landed, showing: action.showing, failed: (error) => sayFailure(error, action, fail) }),
    [through, fail],
  );
  const focus = useCallback((id: string) => core.focus(id), [core]);
  const isBusy = useCallback(() => core.state().busy, [core]);
  return { busy: state.busy, isBusy, change, focus };
}

// "Could not load routines. Check your connection.": what a screen says when its read has failed with nothing loaded. Spelt on a
// screen only by the ReadState part (components/ReadState.tsx), and by the words a lib keeps for a failed read.
export function couldNotLoad(what: string): string {
  return `Could not load ${what}. Check your connection.`;
}

// The React side: reads with `load` while `key` stays the same (null reads nothing), and again from the
// start when it changes. A new key starts with nothing shown, unless `keepAcrossKeys`: then what was
// shown stays until the new key's first read lands (today's Routines over Household midnight). `tables`
// should be a constant, as useRefetchOn asks.
const NOTHING: SyncedState<never> = { data: null, state: 'loading', failed: false, error: null };

// `problems` is the card's write-problem words (useWriteProblem), for a `change` that names a `place`.
export function useSyncedRead<T>(
  load: () => Promise<T>,
  tables: readonly WatchedTable[],
  key: string | null,
  { keepAcrossKeys = false, problems }: { keepAcrossKeys?: boolean; problems?: Parameters<typeof useChange>[1] } = {},
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
  // The card's one-at-a-time guard, with its write and read-back: `change`, `busy`, `isBusy`, `focus`.
  const guard = useChange<T>({ write, readBack }, problems);
  return { ...state, write, refresh, readBack, ...guard };
}
