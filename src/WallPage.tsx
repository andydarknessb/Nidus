import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDeviceSession, requestPairingCode, touchDevice, type PairingCode } from './lib/device';
import { formatCountdown } from './lib/device-format';
import { FiveDayCalendar, PagedCalendar } from './components/FiveDayCalendar';
import { ChangeFeedProvider } from './components/ChangeFeedProvider';
import { HomeRail } from './components/HomeRail';
import { NativeEventSheet } from './components/NativeEventSheet';
import { NavigationRail } from './components/NavigationRail';
import { PeopleStrip } from './components/PeopleStrip';
import { StatusLineProvider } from './components/StatusLine';
import { WallHeader } from './components/WallHeader';
import { useChangeTick } from './lib/change-feed';
import { mealsPath, parseWallRoute, wallDate, wallPath, type CalendarView, type WallRoute } from './lib/calendar-occurrences';
import { householdDay } from './lib/routines';
import { householdViewAfter, loadHousehold, type Household, type HouseholdView } from './lib/household';
import { createProfileFilter, ProfileFilterContext } from './lib/profile-filter';
import { supabase } from './lib/supabase';
import { useStatusLine } from './lib/status-line';
import { localStore, writeLastMode } from './lib/mode';
import { useForecast } from './lib/use-forecast';
import { useDocumentTitle } from './lib/use-document-title';
import { useLightMode, useWallMode } from './lib/use-mode';
import { useProfiles } from './lib/use-profiles';
import { useRoutinesToday } from './lib/use-routines-today';
import { MealsScreen } from './MealsPage';
import { RoutinesChart } from './RoutinesPage';
import { WallListsScreen } from './SharedListsPage';

// A revoked tablet learns of it on the next heartbeat, so this is the upper bound.
const HEARTBEAT_MS = 30_000;
// While showing a code, ask often so a claim is noticed within seconds.
const CLAIM_POLL_MS = 3_000;
const RETRY_MS = 5_000;
// Same cadence as the Routines rail, so a changed Household Timezone reaches the wall within a read.
const HOUSEHOLD_REFRESH_MS = 30_000;
// After a failed Household read, retry sooner.
const HOUSEHOLD_RETRY_MS = 5_000;

// What the Household read listens to: a change to this table reads it again.
const HOUSEHOLD_TABLES = ['households'] as const;

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
      // Never paired, or revoked. The pairing screen is always light, so light is what the next load paints, as soon as the
      // tablet learns this: one revoked at night, whose code cannot be fetched yet, does not paint dark first when it is
      // loaded again. Then show a code that still has time on it.
      writeLastMode(localStore(), 'light');
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
        <StatusLineProvider>
          <HomeShell owner={state.owner} />
        </StatusLineProvider>
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
  useLightMode();
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

// Which screen the address names. The wall pages with pushState rather than reloading, so a tap
// never drops the session or the Routines rail, and Back returns to the previous page.
function useWallRoute(): [WallRoute, (view: CalendarView, date: string) => void, () => void, (date: string | null) => void, () => void] {
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
  return [route, (view, date) => go(wallPath(view, date)), () => go('/'), (date) => go(mealsPath(date)), () => go('/routines')];
}

// What stands in for a screen until the Household has been read (its Timezone says which day every screen
// shows): an empty frame while the read is on its way and, once it has failed, the words that say so, in
// the screen's own wording, so a Wall that cannot reach its server does not pass for a blank one.
function BeforeHousehold({ label, failed, words }: { label: string; failed: boolean; words: string }) {
  return (
    <section aria-label={label} className="rounded-3xl bg-card">
      {failed && (
        <p role="alert" className="p-4 text-xl">
          {words}
        </p>
      )}
    </section>
  );
}

// What each view of the Wall is called in the document's title.
const VIEW_TITLES: Record<WallRoute['view'], string> = { home: 'Home', day: 'Day', week: 'Week', month: 'Month', routines: 'Routines', meals: 'Meals' };

// The landscape wall: a navigation rail down the left, then the header over the screen. The home
// screen is the five-day calendar on the left and, on its right rail, today's Routines above the
// pinned Shared List; the other lists open from the navigation rail. The header carries the next
// meal, on every screen but Meals.
function HomeShell({ owner }: { owner: boolean }) {
  const [route, openView, openHome, openMeals, openRoutines] = useWallRoute();
  // The Household Timezone decides which day the Routines rail shows; none until it is read.
  const [view, setView] = useState<HouseholdView>({ household: null, failed: false });
  const [listsOpen, setListsOpen] = useState(false);
  // Each view names itself in the document's title; the Lists screen, which opens over them, does too.
  useDocumentTitle(listsOpen ? 'Lists' : VIEW_TITLES[route.view]);
  // The Profile filter lives as long as the shell, so it survives a change of screen and is gone on reload.
  // The context hands the pressed ids to every calendar view, a way to clear it to the Native Event
  // sheet and a way to keep it open to the calendar; reading the Profiles prunes it when they change. It says
  // its own clearing on the status line.
  const say = useStatusLine();
  const [filter] = useState(() => createProfileFilter(say));
  const pressed = useSyncExternalStore(filter.subscribe, filter.pressed);
  const filterView = useMemo(() => ({ pressed, clear: filter.clear, touch: filter.touch }), [pressed, filter]);
  // The Household's Profiles, read once for the people strip and for the colour of every event.
  const profiles = useProfiles(filter);
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
  const timezone = view.household?.timezone ?? null;
  // The Household's weather, read once here for the header and every calendar view: nothing, and no
  // request, while it has no place. `weatherOn` is that fact, so the day headings can keep a line for it.
  // `sun` is what the mode goes on besides the Household: the forecast's sunrise and sunset.
  const { forecast, sun } = useForecast(view.household);
  const weatherOn = view.household !== null && view.household.weather_place !== null;
  // The mode of the screen: the Household's Appearance (Auto is light from sunrise to sunset, or from 7:00 to 19:00 in the
  // Household Timezone with no forecast), or what the screen last had while it cannot say: the Household not read yet, or
  // Auto waiting for the forecast's first read. The switch works as soon as the Household is read.
  const toggleMode = useWallMode({ timezone, appearance: view.household?.appearance, sun });
  // Today's Routines, read once for as long as the shell lives and handed to the Routines rail on Home and to
  // the Routines chart, so going from one to the other reads nothing again and a tick in flight is not dropped.
  const routines = useRoutinesToday(timezone);

  const today = timezone ? householdDay(timezone).date : null;
  // The people strip is for the calendar screens (Home, Day, Week and Month), and for no other.
  const onCalendar = route.view === 'home' || route.view === 'day' || route.view === 'week' || route.view === 'month';

  return (
    <main className="grid h-svh grid-cols-[6rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 p-4">
      <NavigationRail
        owner={owner}
        route={route}
        timezone={timezone}
        onOpen={openView}
        onHome={openHome}
        onRoutines={openRoutines}
        onMeals={() => openMeals(null)}
        onLists={() => setListsOpen(true)}
        onAdd={() => setAdding(true)}
        onToggleMode={toggleMode}
      />
      <div className="flex min-w-0 flex-col gap-3">
        <WallHeader household={view.household} today={today} forecast={forecast} onMeals={route.view === 'meals' ? null : () => openMeals(null)} />
        {onCalendar && <PeopleStrip profiles={profiles} routines={routines} filter={filter} pressed={pressed} />}
      </div>
      <ProfileFilterContext.Provider value={filterView}>
        {route.view === 'routines' ? (
          timezone ? (
            <RoutinesChart routines={routines} />
          ) : (
            // The chart before the Household is read: an empty frame that says so if the read failed, as the Routines rail does.
            <section aria-label="Routines" className="rounded-3xl bg-card p-4">
              {view.failed && (
                <p role="alert" className="text-base">
                  Could not load Routines. Check your connection.
                </p>
              )}
            </section>
          )
        ) : route.view === 'meals' ? (
          // Meals is a screen of its own, not a calendar view: it takes the same slot, and before the Household is read it is an empty frame, or says it could not be read.
          timezone ? (
            <MealsScreen timezone={timezone} date={route.date} onNavigate={openMeals} />
          ) : (
            <BeforeHousehold label="Meals" failed={view.failed} words="Could not load meals. Check your connection." />
          )
        ) : route.view !== 'home' && timezone ? (
          <PagedCalendar timezone={timezone} view={route.view} date={route.date} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} profiles={profiles} />
        ) : route.view !== 'home' ? (
          // A calendar page before the Household is read: the empty calendar alone, not the home layout
          // under a navigation rail entry that marks Day, Week or Month.
          <BeforeHousehold label="Calendar" failed={view.failed} words="Could not load the calendar. Check your connection." />
        ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_20rem] gap-4">
          {timezone ? (
            <FiveDayCalendar timezone={timezone} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} profiles={profiles} />
          ) : (
            <BeforeHousehold label="Calendar" failed={view.failed} words="Could not load the calendar. Check your connection." />
          )}
          <HomeRail timezone={timezone} routines={routines} failed={view.failed} />
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
