import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDeviceSession, requestPairingCode, touchDevice, type PairingCode } from './lib/device';
import { formatCountdown } from './lib/device-format';
import { FiveDayCalendar, PagedCalendar } from './components/FiveDayCalendar';
import { ChangeFeedProvider } from './components/ChangeFeedProvider';
import { ConnectionBadge } from './components/ConnectionBadge';
import { NativeEventSheet } from './components/NativeEventSheet';
import { useChangeTick } from './lib/change-feed';
import { parseWallRoute, wallPath, weekStart, type CalendarView, type WallRoute } from './lib/calendar-occurrences';
import { householdDay } from './lib/routines';
import { loadSyncFreshness, staleSyncBadge, type SyncFreshness } from './lib/calendar-accounts';
import { householdViewAfter, loadHousehold, type Household, type HouseholdView } from './lib/household';
import { supabase } from './lib/supabase';
import { RoutinesRail } from './RoutinesPage';
import { PinnedListRail, WallListsScreen } from './SharedListsPage';

// A revoked tablet learns of it on the next heartbeat, so this is the upper bound.
const HEARTBEAT_MS = 30_000;
// While showing a code, ask often so a claim is noticed within seconds.
const CLAIM_POLL_MS = 3_000;
const RETRY_MS = 5_000;
// Same cadence as the Routines rail, so a changed Household Timezone reaches the wall within a read.
const HOUSEHOLD_REFRESH_MS = 30_000;
// After a failed Household read, retry sooner.
const HOUSEHOLD_RETRY_MS = 5_000;
// How often the wall re-reads how fresh the mirror is, and re-words the badge as time passes.
const SYNC_FRESHNESS_MS = 60_000;

// What each read on the wall listens to: a change to any of these tables reads it again.
const HOUSEHOLD_TABLES = ['households'] as const;
const SYNC_TABLES = ['calendar_accounts', 'mirrored_calendars'] as const;

// owner: a Household Account is looking at the Wall (it may open Settings); a Device never is.
type WallState = { kind: 'connecting' } | { kind: 'unpaired'; pairing: PairingCode } | { kind: 'paired'; owner: boolean };

// One anonymous sign-in at a time, so a remount (StrictMode) never mints two sessions.
let pendingSignIn: ReturnType<typeof supabase.auth.signInAnonymously> | undefined;

async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  pendingSignIn ??= supabase.auth.signInAnonymously().finally(() => {
    pendingSignIn = undefined;
  });
  const { data: signedIn, error } = await pendingSignIn;
  if (error || !signedIn.session) throw error ?? new Error('anonymous sign-in returned no session');
  return signedIn.session;
}

// The Wall: a Device's only screen, and a Household Account's view of its calendar. An unpaired
// Device shows a Pairing Code; otherwise the home screen shell. Only a Household Account is
// offered a way into administration.
export function WallPage() {
  const [state, setState] = useState<WallState>({ kind: 'connecting' });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pairing: PairingCode | undefined;

    async function step(): Promise<number> {
      const session = await ensureSession();
      if (!isDeviceSession(session)) {
        // A Household Account sees the Wall too, but is no Device: it writes no heartbeat.
        if (live) setState((prev) => (prev.kind === 'paired' && prev.owner ? prev : { kind: 'paired', owner: true }));
        return HEARTBEAT_MS;
      }
      if (await touchDevice()) {
        pairing = undefined;
        if (live) setState((prev) => (prev.kind === 'paired' && !prev.owner ? prev : { kind: 'paired', owner: false }));
        return HEARTBEAT_MS;
      }
      // Never paired, or revoked: show a code that still has time on it.
      if (!pairing || pairing.expiresAt.getTime() <= Date.now()) pairing = await requestPairingCode();
      const shown = pairing;
      if (live) setState((prev) => (prev.kind === 'unpaired' && prev.pairing === shown ? prev : { kind: 'unpaired', pairing: shown }));
      return CLAIM_POLL_MS;
    }

    async function loop() {
      let delay = RETRY_MS;
      try {
        delay = await step();
      } catch {
        // Offline or the server is restarting: keep what the wall shows and try again.
      }
      if (live) timer = setTimeout(() => void loop(), delay);
    }

    void loop();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  if (state.kind === 'paired') {
    return (
      <ChangeFeedProvider>
        <HomeShell owner={state.owner} />
      </ChangeFeedProvider>
    );
  }
  if (state.kind === 'unpaired') return <PairingScreen pairing={state.pairing} />;
  return (
    <main className="flex min-h-svh items-center justify-center p-8">
      <p role="status" className="text-2xl">
        Connecting
      </p>
    </main>
  );
}

function PairingScreen({ pairing }: { pairing: PairingCode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = pairing.expiresAt.getTime() - now;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="text-4xl font-semibold">Pair this tablet</h1>
      <p className="max-w-2xl text-2xl">
        On your phone, open {window.location.origin}/settings, sign in, and enter this code.
      </p>
      <p className="font-mono text-9xl font-bold tracking-[0.2em]">
        {pairing.code}
      </p>
      <p role="timer" className="text-2xl">
        {remaining > 0 ? `Code expires in ${formatCountdown(remaining)}` : 'Getting a new code'}
      </p>
      <a href="/settings" className="inline-flex min-h-12 items-center text-lg underline">
        Own this Household? Sign in
      </a>
    </main>
  );
}

// The landscape home screen: the five-day calendar on the left; the right rail
// holds today's Routines above the pinned Shared List, and the other lists open from the header.
// The "last synced N hours ago" badge: nothing while every Calendar Account is within an hour,
// so a healthy wall stays clean. A failed read keeps what the wall last knew.
function SyncBadge() {
  const [accounts, setAccounts] = useState<SyncFreshness[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const changes = useChangeTick(SYNC_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const next = await loadSyncFreshness(supabase);
        if (live) setAccounts(next);
      } catch {
        // Offline: keep the last reading.
      }
      if (!live) return;
      setNow(Date.now());
      timer = setTimeout(() => void read(), SYNC_FRESHNESS_MS);
    }
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [changes]);
  const badge = staleSyncBadge(accounts, now);
  if (!badge) return null;
  return (
    <p role="status" className="rounded-lg border border-border px-4 py-2 text-lg">
      {badge}
    </p>
  );
}

// Which screen the address names. The wall pages with pushState rather than reloading, so a tap
// never drops the session or the Routines rail, and Back returns to the previous page.
function useWallRoute(): [WallRoute, (view: CalendarView, date: string) => void, () => void] {
  const read = () => parseWallRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState<WallRoute>(read);
  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (path: string) => {
    // Today while already on today's page changes nothing: no extra step for Back.
    if (path !== window.location.pathname + window.location.search) window.history.pushState(null, '', path);
    setRoute(read());
  };
  return [route, (view, date) => go(wallPath(view, date)), () => go('/')];
}

function HomeShell({ owner }: { owner: boolean }) {
  const [route, openView, openHome] = useWallRoute();
  // The Household Timezone decides which day the Routines rail shows; none until it is read.
  const [view, setView] = useState<HouseholdView>({ household: null, failed: false });
  const [listsOpen, setListsOpen] = useState(false);
  // The sheet that adds a Native Event, and a count of events added from it so the calendar reads again at once.
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  const householdChanges = useChangeTick(HOUSEHOLD_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function read() {
      let outcome: { household: Household } | { failed: true };
      try {
        outcome = { household: await loadHousehold() };
      } catch {
        outcome = { failed: true };
      }
      if (!live) return;
      setView((prev) => householdViewAfter(prev, outcome));
      // After a failed read retry sooner, so the rail appears once the connection is back.
      timer = setTimeout(() => void read(), 'household' in outcome ? HOUSEHOLD_REFRESH_MS : HOUSEHOLD_RETRY_MS);
    }

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [householdChanges]);
  const name = view.household?.name ?? '';
  const timezone = view.household?.timezone ?? null;

  const today = timezone ? householdDay(timezone).date : null;

  return (
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] gap-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">{name}</h1>
        <div className="flex items-center gap-4">
          <ConnectionBadge />
          <SyncBadge />
          {route.view === 'home' && today && (
            <>
              <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={() => openView('week', weekStart(today))}>
                Week
              </button>
              <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={() => openView('day', today)}>
                Day
              </button>
            </>
          )}
          {timezone && (
            <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={() => setAdding(true)}>
              Add event
            </button>
          )}
          <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={() => setListsOpen(true)}>
            Lists
          </button>
          {owner && (
            <a href="/settings" className="inline-flex min-h-12 items-center rounded-lg border border-border px-6 text-lg font-medium">
              Settings
            </a>
          )}
        </div>
      </header>
      {route.view !== 'home' && timezone ? (
        <PagedCalendar timezone={timezone} view={route.view} date={route.date} version={added} onNavigate={openView} onHome={openHome} />
      ) : (
      <div className="grid min-h-0 grid-cols-[1fr_24rem] gap-6">
        {timezone ? <FiveDayCalendar timezone={timezone} version={added} /> : <section aria-label="Calendar" className="rounded-xl border border-border" />}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          {timezone ? (
            <RoutinesRail timezone={timezone} />
          ) : (
            <aside aria-label="Today's Routines" className="rounded-xl border border-border p-4">
              {view.failed && (
                <p role="alert" className="text-base">
                  Could not load Routines. Check your connection.
                </p>
              )}
            </aside>
          )}
          <PinnedListRail />
        </div>
      </div>
      )}
      {listsOpen && <WallListsScreen onClose={() => setListsOpen(false)} />}
      {adding && timezone && today && (
        <NativeEventSheet
          timezone={timezone}
          // The day the wall is on: the paged view's day, else today.
          date={route.view !== 'home' && route.date ? route.date : today}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setAdded((count) => count + 1);
          }}
        />
      )}
    </main>
  );
}
