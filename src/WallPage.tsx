import { Calendar1, CalendarDays, CalendarRange, House, ListChecks, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ComponentProps } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDeviceSession, requestPairingCode, touchDevice, type PairingCode } from './lib/device';
import { formatCountdown } from './lib/device-format';
import { FiveDayCalendar, PagedCalendar } from './components/FiveDayCalendar';
import { ChangeFeedProvider } from './components/ChangeFeedProvider';
import { ConnectionBadge } from './components/ConnectionBadge';
import { NativeEventSheet } from './components/NativeEventSheet';
import { useChangeTick } from './lib/change-feed';
import { formatClock, formatDate, navigationRailDate, parseWallRoute, wallDate, wallPath, type CalendarView, type WallRoute } from './lib/calendar-occurrences';
import { householdDay } from './lib/routines';
import { loadSyncFreshness, staleSyncBadge, type SyncFreshness } from './lib/calendar-accounts';
import { householdViewAfter, loadHousehold, type Household, type HouseholdView } from './lib/household';
import { supabase } from './lib/supabase';
import { useNow } from './lib/wall-hooks';
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

type WallState = { kind: 'connecting' } | { kind: 'unpaired'; pairing: PairingCode } | { kind: 'paired' };

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

// The wall: the tablet's only screen. Unpaired, it shows a Pairing Code; paired,
// the home screen shell. It never offers a way into administration.
export function WallPage() {
  const [state, setState] = useState<WallState>({ kind: 'connecting' });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pairing: PairingCode | undefined;

    async function step(): Promise<number> {
      const session = await ensureSession();
      if (!isDeviceSession(session)) {
        // A Household Account landed on the wall (the Google sign-in redirect): send it to settings.
        window.location.replace('/settings');
        return HEARTBEAT_MS;
      }
      if (await touchDevice()) {
        pairing = undefined;
        if (live) setState((prev) => (prev.kind === 'paired' ? prev : { kind: 'paired' }));
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
        <HomeShell />
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
    </main>
  );
}

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

// One entry of the navigation rail: an icon over a word, at least 64 px square. The current one is
// marked by a bar down its edge and a filled ground as well as `aria-current`, so it never rests on
// colour alone.
function NavigationRailEntry({ icon: Icon, label, current = false, ...props }: { icon: LucideIcon; label: string; current?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      className={`relative flex min-h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-lg text-base font-medium disabled:opacity-50 ${current ? 'bg-muted' : ''}`}
      {...props}
    >
      {current && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-foreground" />}
      <Icon aria-hidden className="size-7 shrink-0" />
      {label}
    </button>
  );
}

// The navigation rail down the left side: Home, Day, Week, Month and Lists. Day, Week and Month keep the
// date the wall is on (navigationRailDate), read at the tap so one just after Household midnight is right,
// and wait for the Household Timezone. Lists opens the Lists screen over this one rather than going
// anywhere. Its column is its whole width, border and padding included, and must stay at most 90 px:
// the five day columns at 1280 px need 140 px each. The longest labels still to come (Routines,
// Settings) fit in it.
function NavigationRail({
  route,
  timezone,
  onOpen,
  onHome,
  onLists,
}: {
  route: WallRoute;
  timezone: string | null;
  onOpen: (view: CalendarView, date: string) => void;
  onHome: () => void;
  onLists: () => void;
}) {
  const open = (view: CalendarView) => {
    if (timezone) onOpen(view, navigationRailDate(view, route, householdDay(timezone).date));
  };
  return (
    <nav aria-label="Wall sections" className="row-span-2 flex flex-col gap-2 rounded-xl border border-border p-1.5">
      <NavigationRailEntry icon={House} label="Home" current={route.view === 'home'} onClick={onHome} />
      <NavigationRailEntry icon={Calendar1} label="Day" current={route.view === 'day'} disabled={!timezone} onClick={() => open('day')} />
      <NavigationRailEntry icon={CalendarRange} label="Week" current={route.view === 'week'} disabled={!timezone} onClick={() => open('week')} />
      <NavigationRailEntry icon={CalendarDays} label="Month" current={route.view === 'month'} disabled={!timezone} onClick={() => open('month')} />
      <NavigationRailEntry icon={ListChecks} label="Lists" aria-haspopup="dialog" onClick={onLists} />
    </nav>
  );
}

// The time, large, and the date beside it, in the Household Timezone. useNow redraws it within half a
// minute and the moment Household midnight passes, so the date turns with no reload.
function WallClock({ timezone }: { timezone: string }) {
  const now = useNow(timezone).getTime();
  return (
    <p className="flex shrink-0 items-baseline gap-3">
      <span className="text-5xl font-semibold tabular-nums">{formatClock(now, timezone)}</span>
      <span className="text-2xl">{formatDate(now, timezone)}</span>
    </p>
  );
}

// The landscape wall: a navigation rail down the left, then the header over the screen. The home
// screen is the five-day calendar on the left and, on its right rail, today's Routines above the
// pinned Shared List; the other lists open from the navigation rail.
function HomeShell() {
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
      // After a failed read retry sooner, so the Routines rail appears once the connection is back.
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
    <main className="grid h-svh grid-cols-[5.5rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 p-4">
      <NavigationRail route={route} timezone={timezone} onOpen={openView} onHome={openHome} onLists={() => setListsOpen(true)} />
      <header className="flex min-h-12 items-center gap-6">
        <h1 className="min-w-0 truncate text-3xl font-semibold">{name}</h1>
        {timezone && <WallClock timezone={timezone} />}
        <div className="ml-auto flex shrink-0 items-center gap-4">
          <ConnectionBadge />
          <SyncBadge />
          {timezone && (
            <button type="button" className="min-h-12 rounded-lg border border-border px-6 text-lg font-medium" onClick={() => setAdding(true)}>
              Add event
            </button>
          )}
        </div>
      </header>
      {route.view !== 'home' && timezone ? (
        <PagedCalendar timezone={timezone} view={route.view} date={route.date} version={added} onNavigate={openView} />
      ) : (
      <div className="grid min-h-0 grid-cols-[1fr_22rem] gap-4">
        {timezone ? <FiveDayCalendar timezone={timezone} version={added} onNavigate={openView} /> : <section aria-label="Calendar" className="rounded-xl border border-border" />}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
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
          // The day the wall is on: today when the page shown holds it, else that page's first day.
          date={wallDate(route, today)}
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
