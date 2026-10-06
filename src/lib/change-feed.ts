import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChangeFeed, Connection, WatchedTable } from './realtime';

// The React side of the change feed (realtime.ts): a screen says which tables it reads and what
// to do when one changes. Without a provider (a screen under test) every hook does nothing.

export const ChangeFeedContext = createContext<ChangeFeed | null>(null);

// Calls `refetch` when any of `tables` changes. `tables` should be a constant so the watch is not remade.
export function useRefetchOn(tables: readonly WatchedTable[], refetch: () => void): void {
  const feed = useContext(ChangeFeedContext);
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });
  useEffect(() => feed?.watch(tables, () => latest.current()), [feed, tables]);
}

// A number that goes up each time one of `tables` changes: put it in an effect's dependencies to read again.
export function useChangeTick(tables: readonly WatchedTable[]): number {
  const [tick, setTick] = useState(0);
  useRefetchOn(tables, () => setTick((count) => count + 1));
  return tick;
}

// Whether the screen is hearing the server. 'connecting' until the first time it does.
export function useConnection(): Connection {
  const feed = useContext(ChangeFeedContext);
  const [status, setStatus] = useState<Connection>(() => feed?.status() ?? 'connecting');
  useEffect(() => {
    if (!feed) return;
    setStatus(feed.status());
    return feed.onStatus(setStatus);
  }, [feed]);
  return status;
}
