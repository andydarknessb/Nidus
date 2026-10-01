import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// Cross-device sync (CONTEXT.md: Household, Device). One Realtime channel per screen session
// listens to every Household table; a change tells the screens that read that table to read it
// again. A change's payload is never used: no cache is edited in place, so what a screen shows
// is always what a query returned. Row-level security decides what each principal hears.

export const WATCHED_TABLES = [
  'households',
  'profiles',
  'devices',
  'calendar_accounts',
  'mirrored_calendars',
  'synced_events',
  'native_events',
  'native_event_profiles',
  'routines',
  'routine_completions',
  'shared_lists',
  'list_items',
] as const;

export type WatchedTable = (typeof WATCHED_TABLES)[number];

// The tables behind the `calendar_occurrences` view: an event, its Profiles, and the colour each inherits.
export const OCCURRENCE_TABLES: readonly WatchedTable[] = ['synced_events', 'native_events', 'native_event_profiles', 'mirrored_calendars', 'profiles'];

export type Connection = 'connecting' | 'online' | 'offline';

export type ChangeFeed = {
  // Calls `onChange` once a watched table changes, merging a burst of changes into one call.
  // Returns the function that stops watching.
  watch(tables: readonly WatchedTable[], onChange: () => void): () => void;
  status(): Connection;
  onStatus(listener: (status: Connection) => void): () => void;
  // Resolves the first time the subscription is live.
  ready: Promise<void>;
  close(): void;
};

// A burst of writes (a calendar sync lands hundreds of events) is one refetch, a moment later.
const DEBOUNCE_MS = 150;
// How long after the server closes the channel before a new one is opened.
const REJOIN_MS = 5_000;

type Watcher = { tables: ReadonlySet<WatchedTable>; onChange: () => void; timer: ReturnType<typeof setTimeout> | undefined };

export function openChangeFeed(client: SupabaseClient, options: { debounceMs?: number } = {}): ChangeFeed {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const watchers = new Set<Watcher>();
  const listeners = new Set<(status: Connection) => void>();
  let channelState: Connection = 'connecting';
  // The browser's own word on whether there is a network; trusted over the socket, which can take a minute to notice.
  let networkUp = typeof navigator === 'undefined' || navigator.onLine !== false;
  let current: Connection = networkUp ? channelState : 'offline';
  let wasLive = false;
  let closed = false;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const poke = (watcher: Watcher) => {
    if (watcher.timer !== undefined) return;
    watcher.timer = setTimeout(() => {
      watcher.timer = undefined;
      if (!closed && watchers.has(watcher)) watcher.onChange();
    }, debounceMs);
  };
  const pokeAll = () => watchers.forEach(poke);

  const update = () => {
    const next: Connection = networkUp ? channelState : 'offline';
    if (next === current) return;
    current = next;
    listeners.forEach((listener) => listener(next));
  };

  let channel: RealtimeChannel | undefined;
  let rejoin: ReturnType<typeof setTimeout> | undefined;

  // realtime-js retries a channel that errored or timed out, but a channel the server closed
  // (its token expired, say) is dropped for good: open a fresh one.
  const join = () => {
    // wait: SUBSCRIBED only once the server's change subscription is really live, so a change
    // made right after it (or after a catch-up read) is never missed.
    let next: RealtimeChannel = client.channel(`household-changes-${Math.random().toString(36).slice(2)}`, {
      config: { postgres_changes_options: { wait: true } },
    });
    for (const table of WATCHED_TABLES) {
      next = next.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        for (const watcher of watchers) if (watcher.tables.has(table)) poke(watcher);
      });
    }
    channel = next;
    next.subscribe((state) => {
      if (closed || channel !== next) return;
      if (state === 'SUBSCRIBED') {
        channelState = 'online';
        markReady();
        // Changes made while the feed was down were never heard: read everything again once it is back.
        if (wasLive) pokeAll();
        wasLive = true;
      } else {
        channelState = wasLive ? 'offline' : 'connecting';
        if (state === 'CLOSED') {
          clearTimeout(rejoin);
          rejoin = setTimeout(() => {
            if (closed) return;
            // Forget it first, so the CLOSED that removing it reports is not heard as another loss.
            channel = undefined;
            void client.removeChannel(next);
            join();
          }, REJOIN_MS);
        }
      }
      update();
    });
  };
  join();

  const onNetwork = () => {
    networkUp = navigator.onLine;
    // Reads that failed while offline are retried the moment the network is back.
    if (networkUp) pokeAll();
    update();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onNetwork);
    window.addEventListener('offline', onNetwork);
  }

  return {
    watch(tables, onChange) {
      const watcher: Watcher = { tables: new Set(tables), onChange, timer: undefined };
      watchers.add(watcher);
      return () => {
        clearTimeout(watcher.timer);
        watchers.delete(watcher);
      };
    },
    status: () => current,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready,
    close() {
      closed = true;
      for (const watcher of watchers) clearTimeout(watcher.timer);
      watchers.clear();
      listeners.clear();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onNetwork);
        window.removeEventListener('offline', onNetwork);
      }
      clearTimeout(rejoin);
      if (channel) void client.removeChannel(channel);
    },
  };
}
