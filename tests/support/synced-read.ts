import { vi } from 'vitest';
import { startSyncedRead, type SyncedState } from '../../src/lib/synced-read';

// Helpers for the synced read's tests and the change's: a read the test resolves by hand, and a settling of the promises that follow
// a settled read or write. No stack is needed.
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function harness() {
  const reads: ReturnType<typeof deferred<string[]>>[] = [];
  const states: SyncedState<string[]>[] = [];
  const read = startSyncedRead<string[]>({
    load: () => {
      const next = deferred<string[]>();
      reads.push(next);
      return next.promise;
    },
    onChange: (state) => states.push(state),
  });
  const shown = () => states.map((state) => state.data);
  const last = () => states[states.length - 1];
  return { read, reads, states, shown, last };
}

// Let the promise continuations that follow a settled read or write run.
export const settle = () => vi.advanceTimersByTimeAsync(0);
