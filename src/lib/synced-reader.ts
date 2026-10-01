// A screen that shows data it reads and also writes it optimistically (CONTEXT.md: Routine
// Completion, Shared List) has two sources of change: its own taps and other devices, heard
// through Realtime. This keeps them from fighting, with one rule: the screen's own write is
// shown at once, and nothing read from the server is shown over it until the write has landed.
// After the last write, a read replaces whatever was shown with what the server holds, which
// includes anything another device did meanwhile. No cache is edited in place.

export type SyncedReader = {
  // Read now, or after the writes in flight if there are any. A newer read supersedes an older one.
  refresh(): void;
  // Runs a write. Reads stay out of its way, and one follows it, whether it worked or not.
  write<T>(work: () => Promise<T>): Promise<T>;
  // Nothing is applied after this.
  dispose(): void;
};

export function createSyncedReader<T>(load: () => Promise<T>, apply: (value: T) => void, onError: (error: unknown) => void = () => undefined): SyncedReader {
  let writes = 0;
  // Counts reads started and writes begun or ended: an answer from before the latest of either is stale.
  let epoch = 0;
  let disposed = false;

  const read = () => {
    const started = ++epoch;
    load().then(
      (value) => {
        if (!disposed && epoch === started && writes === 0) apply(value);
      },
      (error) => {
        if (!disposed && epoch === started) onError(error);
      },
    );
  };

  return {
    refresh() {
      if (disposed || writes > 0) return;
      read();
    },
    async write(work) {
      writes += 1;
      epoch += 1;
      try {
        return await work();
      } finally {
        writes -= 1;
        epoch += 1;
        if (writes === 0 && !disposed) read();
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
