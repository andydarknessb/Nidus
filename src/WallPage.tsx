import { Calendar1, CalendarDays, CalendarRange, House, ListChecks, Plus, Settings, Utensils, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDeviceSession, requestPairingCode, touchDevice, type PairingCode } from './lib/device';
import { formatCountdown } from './lib/device-format';
import { FiveDayCalendar, PagedCalendar } from './components/FiveDayCalendar';
import { ChangeFeedProvider } from './components/ChangeFeedProvider';
import { ConnectionBadge } from './components/ConnectionBadge';
import { NativeEventSheet } from './components/NativeEventSheet';
import { ProfileChips } from './components/ProfileChips';
import { WeatherNow } from './components/Weather';
import { useChangeTick } from './lib/change-feed';
import { formatClock, formatDate, mealsPath, navigationRailDate, parseWallRoute, wallDate, wallPath, type CalendarView, type WallRoute } from './lib/calendar-occurrences';
import { householdDay } from './lib/routines';
import { loadSyncFreshness, staleSyncBadge, type SyncFreshness } from './lib/calendar-accounts';
import { householdViewAfter, loadHousehold, type Household, type HouseholdView } from './lib/household';
import { createProfileFilter, ProfileFilterContext } from './lib/profile-filter';
import { supabase } from './lib/supabase';
import { useForecast } from './lib/use-forecast';
import { useNow } from './lib/wall-hooks';
import { MealsScreen, TodaysMealsCard } from './MealsPage';
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

// Set once the owner leaves for /settings: the poll loop must not mint a new anonymous session while the old one is signed out.
let leaving = false;

async function ensureSession(): Promise<Session> {
  if (leaving) throw new Error('leaving the Wall');
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
      {/* This tablet is not paired yet, so dropping its anonymous session loses nothing, and /settings then offers the Google sign-in instead of the Device dead end. */}
      <a
        href="/settings"
        className="inline-flex min-h-12 items-center text-lg underline"
        onClick={(event) => {
          event.preventDefault();
          leaving = true;
          void supabase.auth.signOut().finally(() => window.location.assign('/settings'));
        }}
      >
        Own this Household? Sign in
      </a>
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
function useWallRoute(): [WallRoute, (view: CalendarView, date: string) => void, () => void, (date: string | null) => void] {
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
  return [route, (view, date) => go(wallPath(view, date)), () => go('/'), (date) => go(mealsPath(date))];
}

// One entry of the navigation rail: an icon over a word, at least 64 px square. The current one is
// marked by a bar down its edge and a filled ground as well as `aria-current`, so it never rests on
// colour alone. A word too long for one line wraps; the entry then grows taller, never wider.
function NavigationRailEntry({ icon: Icon, label, current = false, className = '', ...props }: { icon: LucideIcon; label: string; current?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      className={`relative flex min-h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-lg text-base font-medium disabled:opacity-50 ${current ? 'bg-muted' : ''} ${className}`}
      {...props}
    >
      {current && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-foreground" />}
      <Icon aria-hidden className="size-7 shrink-0" />
      {label}
    </button>
  );
}

// The navigation rail down the left side: Home, Day, Week, Month, Meals and Lists, and at its foot Add event.
// Day, Week and Month keep the date the wall is on (navigationRailDate), read at the tap so one just after
// Household midnight is right, and wait for the Household Timezone. Meals always opens this week, with
// no date in its address, so it needs no Household Timezone to open. Lists opens the Lists screen over
// this one rather than going anywhere. Add event is an action, not a section: it is never the current
// entry, opens the Native Event sheet, and is drawn as the primary action. Above it, for a Household
// Account only, sits the link to Settings: a Device is never offered a way into administration. Its column is its whole
// width, border and padding included, and must stay at most 90 px: the five day columns at 1280 px need
// 140 px each. The longest labels still to come (Routines, Settings) fit in it.
function NavigationRail({
  route,
  timezone,
  onOpen,
  onHome,
  onMeals,
  onLists,
  onAdd,
  owner,
}: {
  route: WallRoute;
  timezone: string | null;
  onOpen: (view: CalendarView, date: string) => void;
  onHome: () => void;
  onMeals: () => void;
  onLists: () => void;
  onAdd: () => void;
  owner: boolean;
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
      <NavigationRailEntry icon={Utensils} label="Meals" current={route.view === 'meals'} onClick={onMeals} />
      <NavigationRailEntry icon={ListChecks} label="Lists" aria-haspopup="dialog" onClick={onLists} />
      <div className="mt-auto flex flex-col gap-2">
        {owner && (
          <a href="/settings" className="flex min-h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-lg text-base font-medium">
            <Settings aria-hidden className="size-7 shrink-0" />
            Settings
          </a>
        )}
        <NavigationRailEntry icon={Plus} label="Add event" aria-haspopup="dialog" disabled={!timezone} onClick={onAdd} className="bg-primary text-primary-foreground" />
      </div>
    </nav>
  );
}

// The time, large, and the date beside it, in the Household Timezone. useNow redraws it on each minute
// and the moment Household midnight passes, so the minute turns on the minute and the date with no reload.
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
function HomeShell({ owner }: { owner: boolean }) {
  const [route, openView, openHome, openMeals] = useWallRoute();
  // The Household Timezone decides which day the Routines rail shows; none until it is read.
  const [view, setView] = useState<HouseholdView>({ household: null, failed: false });
  const [listsOpen, setListsOpen] = useState(false);
  // The Profile filter lives as long as the shell, so it survives a change of screen and is gone on reload.
  // The context hands the pressed ids to every calendar view, and a way to clear it to the Native Event
  // sheet; the chips prune it when the Profiles change.
  const [filter] = useState(createProfileFilter);
  const pressed = useSyncExternalStore(filter.subscribe, filter.pressed);
  const filterView = useMemo(() => ({ pressed, clear: filter.clear }), [pressed, filter]);
  useEffect(() => () => filter.dispose(), [filter]);
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
  // The Household's weather, read once here for the header and every calendar view: nothing, and no
  // request, while it has no place. `weatherOn` is that fact, so the day headings can keep a line for it.
  const forecast = useForecast(view.household);
  const weatherOn = view.household !== null && view.household.weather_place !== null;

  const today = timezone ? householdDay(timezone).date : null;
  // The Profile chips are for the calendar screens; a screen that is not one (Meals) turns them off here.
  // They are hidden, not unmounted, so they keep their Profiles.
  const onCalendar = route.view !== 'meals';

  return (
    <main className="grid h-svh grid-cols-[5.5rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 p-4">
      <NavigationRail
        owner={owner}
        route={route}
        timezone={timezone}
        onOpen={openView}
        onHome={openHome}
        onMeals={() => openMeals(null)}
        onLists={() => setListsOpen(true)}
        onAdd={() => setAdding(true)}
      />
      <header className="flex min-h-12 items-center gap-6">
        <h1 className="min-w-0 truncate text-3xl font-semibold">{name}</h1>
        {timezone && <WallClock timezone={timezone} />}
        {view.household && today && <WeatherNow forecast={forecast} unit={view.household.temperature_unit} today={today} />}
        <ProfileChips filter={filter} pressed={pressed} hidden={!onCalendar} />
        <div className="ml-auto flex shrink-0 items-center gap-4">
          <ConnectionBadge />
          <SyncBadge />
        </div>
      </header>
      <ProfileFilterContext.Provider value={filterView}>
        {route.view === 'meals' ? (
          // Meals is a screen of its own, not a calendar view: it takes the same slot, and before the Household is read it is empty.
          timezone ? <MealsScreen timezone={timezone} date={route.date} onNavigate={openMeals} /> : <section aria-label="Meals" className="rounded-xl border border-border" />
        ) : route.view !== 'home' && timezone ? (
          <PagedCalendar timezone={timezone} view={route.view} date={route.date} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} />
        ) : route.view !== 'home' ? (
          // A calendar page before the Household is read: the empty calendar alone, not the home layout
          // under a navigation rail entry that marks Day or Week.
          <section aria-label="Calendar" className="rounded-xl border border-border" />
        ) : (
        <div className="grid min-h-0 grid-cols-[1fr_22rem] gap-4">
          {timezone ? <FiveDayCalendar timezone={timezone} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} /> : <section aria-label="Calendar" className="rounded-xl border border-border" />}
          <div className="flex min-h-0 flex-col gap-4">
            {/* Today's meals take the height they need, and nothing at all when none is planned, so the Routines
                rail and the pinned list then share the right rail exactly as before. The two keep 13 rem each
                (the pinned list's controls and an item need that): past it the card shrinks and scrolls, so
                the wall never does. */}
            {timezone && <TodaysMealsCard timezone={timezone} />}
            <div className="grid min-h-[27rem] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
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
      </ProfileFilterContext.Provider>
    </main>
  );
}
