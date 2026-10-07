import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefetchOn } from './change-feed';
import type { WatchedTable } from './realtime';
import { keepIfSame } from './same-data';

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
// - A failed read keeps what is shown. `unread` is a failure with nothing ever loaded: the only
//   time a screen says it could not load.

export const REFRESH_MS = 30_000;
export const RETRY_MS = 5_000;

export type SyncedState<T> = { data: T | null; failed: boolean; unread: boolean };

export interface SyncedRead<T> {
  // A change notice: read now, or once more after the read in flight. Waits for writes in flight.
  poke(): void;
  // Runs `work`, showing `change` until it fails or the read after it lands. Rejects as `work` does.
  write<R>(work: () => Promise<R>, change?: (shown: T) => T): Promise<R>;
  // Nothing is shown or read after this.
  stop(): void;
}

export function startSyncedRead<T>(options: { load: () => Promise<T>; onChange: (state: SyncedState<T>) => void }): SyncedRead<T> {
  const { load, onChange } = options;
  let live = true;
  let read: T | null = null;
  let failed = false;
  let pending: { change: (shown: T) => T }[] = [];
  let writes = 0;
  // Counts reads started and writes begun or ended: a read from before the latest of either is stale.
  let epoch = 0;
  let reading = false;
  let poked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let said: SyncedState<T> | null = null;

  const notify = () => {
    const data = read === null ? null : pending.reduce<T>((shown, entry) => entry.change(shown), read);
    const state = { data, failed, unread: failed && read === null };
    if (said && said.data === state.data && said.failed === state.failed && said.unread === state.unread) return;
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
        failed = false;
        notify();
      }
    } catch {
      delay = RETRY_MS;
      if (live && epoch === started) {
        failed = true;
        notify();
      }
    }
    reading = false;
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
    async write(work, change) {
      writes += 1;
      epoch += 1;
      const entry = change ? { change } : null;
      if (entry) {
        pending = [...pending, entry];
        notify();
      }
      try {
        return await work();
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
    stop() {
      live = false;
      clearTimeout(timer);
    },
  };
}

// "Could not load routines. Check your connection.": what a screen says when its read is unread.
export function couldNotLoad(what: string): string {
  return `Could not load ${what}. Check your connection.`;
}

// The React side: reads with `load` while `key` stays the same (null reads nothing), and again from the
// start when it changes. What was shown stays until the new key's first read lands. `tables` should be
// a constant, as useRefetchOn asks.
export function useSyncedRead<T>(
  load: () => Promise<T>,
  tables: readonly WatchedTable[],
  key: string | null,
): SyncedState<T> & { write: <R>(work: () => Promise<R>, change?: (shown: T) => T) => Promise<R> } {
  const [state, setState] = useState<SyncedState<T>>({ data: null, failed: false, unread: false });
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const current = useRef<SyncedRead<T> | null>(null);
  useEffect(() => {
    if (key === null) return;
    // A new key's read that fails before anything lands keeps what the old key showed, as the screen did before it changed.
    const onChange = (next: SyncedState<T>) => setState((was) => (next.data === null && was.data !== null ? { ...next, data: was.data, unread: false } : next));
    const started = startSyncedRead<T>({ load: () => latest.current(), onChange });
    current.current = started;
    return () => {
      started.stop();
      current.current = null;
    };
  }, [key]);
  useRefetchOn(tables, () => current.current?.poke());
  const write = useCallback(<R,>(work: () => Promise<R>, change?: (shown: T) => T) => (current.current ? current.current.write(work, change) : work()), []);
  return { ...state, write };
}
