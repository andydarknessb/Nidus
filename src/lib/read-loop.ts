// The read loop behind a screen that reads from the server and listens to the change feed: it reads
// at once, again `refreshMs` after a read lands, and again `retryMs` after one fails. A read in flight
// always finishes and delivers its result; pokes that arrive meanwhile are remembered and cause exactly
// one more read as soon as it settles. A poke while idle reads at once. After `stop` nothing is
// delivered and nothing more is read.

export interface ReadLoop {
  poke(): void;
  stop(): void;
}

export function startReadLoop<T>(options: {
  read: () => Promise<T>;
  onResult: (result: T) => void;
  onFail: () => void;
  refreshMs: number;
  retryMs: number;
}): ReadLoop {
  const { read, onResult, onFail, refreshMs, retryMs } = options;
  let live = true;
  let reading = false;
  let poked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function run() {
    clearTimeout(timer);
    reading = true;
    poked = false;
    let delay = refreshMs;
    try {
      const result = await read();
      if (live) onResult(result);
    } catch {
      // Keep what the screen shows and try again sooner.
      if (live) onFail();
      delay = retryMs;
    }
    reading = false;
    if (!live) return;
    if (poked) void run();
    else timer = setTimeout(() => void run(), delay);
  }

  void run();
  return {
    poke() {
      if (!live) return;
      if (reading) poked = true;
      else void run();
    },
    stop() {
      live = false;
      clearTimeout(timer);
    },
  };
}
