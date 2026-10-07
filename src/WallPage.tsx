import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isDeviceSession, requestPairingCode, touchDevice, type PairingCode } from './lib/device';
import { formatCountdown } from './lib/device-format';
import { FiveDayCalendar, PagedCalendar } from './components/FiveDayCalendar';
import { BeforeHousehold } from './components/BeforeHousehold';
import { ChangeFeedProvider } from './components/ChangeFeedProvider';
import { EmptyWords } from './components/EmptyWords';
import { HomeRail } from './components/HomeRail';
import { NativeEventSheet } from './components/NativeEventSheet';
import { NavigationRail } from './components/NavigationRail';
import { PeopleStrip } from './components/PeopleStrip';
import { PhoneShell } from './components/PhoneShell';
import { StatusLineProvider } from './components/StatusLine';
import { WallHeader, WallTime } from './components/WallHeader';
import { useChangeTick } from './lib/change-feed';
import { mealsPath, onCalendarScreen, parseWallRoute, wallDate, wallPath, type CalendarView, type WallRoute } from './lib/calendar-occurrences';
import { householdDay } from './lib/routines';
import { householdViewAfter, loadHousehold, type Household, type HouseholdView } from './lib/household';
import { deviceStorage, gateWords, recallHousehold, rememberHousehold } from './lib/remembered-household';
import { createProfileFilter, ProfileFilterContext, sayOnCalendar } from './lib/profile-filter';
import { supabase } from './lib/supabase';
import { useStatusLine } from './lib/status-line';
import { localStore, writeLastMode } from './lib/mode';
import { homeGrid, useHomeLayout } from './lib/home-layout';
import { useForecast } from './lib/use-forecast';
import { useDocumentTitle } from './lib/use-document-title';
import { useLightMode, useWallMode } from './lib/use-mode';
import { useProfiles } from './lib/use-profiles';
import { useRoutinesToday } from './lib/use-routines-today';
import { MealsScreen } from './MealsPage';
import { PhoneWall } from './PhoneWall';
import { RoutinesChart } from './RoutinesPage';
import { ListsScreen } from './SharedListsPage';

// A revoked tablet learns of it on the next heartbeat, so this is the upper bound.
const HEARTBEAT_MS = 30_000;
// While showing a code, ask often so a claim is noticed within seconds.
const CLAIM_POLL_MS = 3_000;
const RETRY_MS = 5_000;
// Same cadence as the Routines read, so a changed Household Timezone reaches the wall within a read.
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
  // Failed tries in a row: the gate says "No internet" from the third; a successful step sets it back to zero.
  const [failedTries, setFailedTries] = useState(0);

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
        if (live) setFailedTries(0);
      } catch {
        // Offline or the server is restarting: keep what the wall shows and try again.
        if (live) setFailedTries((tries) => tries + 1);
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
  return <ConnectingScreen failedTries={failedTries} />;
}

// The gate before the server has answered. The Household's name and a clock in its Household Timezone
// show at once when this Device remembers them; nothing else is drawn from memory, so a revoked Device
// shows a name and a clock and no calendar, Routine or list. A Wall with nothing remembered shows the words alone.
function ConnectingScreen({ failedTries }: { failedTries: number }) {
  const [remembered] = useState(() => recallHousehold(deviceStorage()));
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      {remembered && (
        // The header's own clock, name and date, alone on the screen: what the Wall shows first is what stays.
        <div className="flex max-w-full items-center gap-6 text-left">
          <WallTime name={remembered.name} timezone={remembered.timezone} />
        </div>
      )}
      <p role="status" className="text-2xl">
        {gateWords(failedTries)}
      </p>
    </main>
  );
}

// The screen of a tablet that is not paired: always light (useLightMode), in the look's own faces. The title and the code are
// Young Serif, whose figures font-display makes lining and tabular as the clock's are, so the code's digits stand as tall as its
// letters and each is one width. No monospace face is shipped, and none is asked for: the code is spaced out by letter-spacing
// alone, with as much space before it as after it so that it sits in the middle. "sign in," is one unit, so the sentence never
// leaves "sign" at the end of a line and "in" at the start of the next.
export function PairingScreen({ pairing }: { pairing: PairingCode }) {
  useLightMode();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = pairing.expiresAt.getTime() - now;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="font-display text-[40px] leading-[44px]">Pair this tablet</h1>
      <p className="max-w-2xl text-2xl">
        On your phone, open {window.location.origin}/settings, <span className="whitespace-nowrap">sign in,</span> and enter this code.
      </p>
      <p className="font-display text-9xl leading-none tracking-[0.2em] pl-[0.2em]">{pairing.code}</p>
      <p role="timer" className="text-2xl">
        {remaining > 0 ? `Code expires in ${formatCountdown(remaining)}` : 'Getting a new code'}
      </p>
      {/* This tablet is not paired yet, so dropping its anonymous session loses nothing, and /settings then offers the Google sign-in instead of the Device dead end. */}
      <a
        href="/settings"
        className="inline-flex min-h-12 items-center text-lg whitespace-nowrap underline"
        onClick={(event) => {
          event.preventDefault();
          leaving = true;
          void supabase.auth.signOut().finally(() => window.location.assign('/settings'));
        }}
      >
        Own this household? Sign in
      </a>
    </main>
  );
}

// Which screen the address names. The wall pages with pushState rather than reloading, so a tap
// never drops the session or the Routines read, and Back returns to the previous page.
function useWallRoute(): [WallRoute, (view: CalendarView, date: string) => void, () => void, (date: string | null) => void, () => void, () => void] {
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
  return [route, (view, date) => go(wallPath(view, date)), () => go('/'), (date) => go(mealsPath(date)), () => go('/routines'), () => go('/lists')];
}

// The frame that stands in for a screen until the Household has been read; it lives in its own file so the phone's screens can
// draw it too, and is still this page's to import.
export { BeforeHousehold };

// What each view of the Wall is called in the document's title.
const VIEW_TITLES: Record<WallRoute['view'], string> = { home: 'Home', day: 'Day', week: 'Week', month: 'Month', routines: 'Routines', meals: 'Meals', lists: 'Lists' };

// The landscape wall: a navigation rail down the left, then the header over the screen. The home
// screen is the schedule of five days (four on a narrow screen) on the left and, on its right rail, Up next above the pinned
// Shared List; every list is on the Lists screen, opened from the navigation rail. The header carries
// the next meal, on every screen but Meals.
function HomeShell({ owner }: { owner: boolean }) {
  const [route, openView, openHome, openMeals, openRoutines, openLists] = useWallRoute();
  // The Household Timezone decides which day Up next and the Routines chart show; none until it is read.
  const [view, setView] = useState<HouseholdView>({ household: null, failed: false });
  // Each view names itself in the document's title.
  useDocumentTitle(VIEW_TITLES[route.view]);
  // The Profile filter lives as long as the shell, so it survives a change of screen and is gone on reload.
  // The context hands the pressed ids to every calendar view, a way to clear it to the Native Event
  // sheet and a way to keep it open to the calendar; reading the Profiles prunes it when they change. It says
  // its own clearing on the status line, on the calendar screens and no other: it reads the screen when the time is up.
  const say = useStatusLine();
  const screen = useRef(route.view);
  useEffect(() => {
    screen.current = route.view;
  });
  const [filter] = useState(() => createProfileFilter(sayOnCalendar(say, () => screen.current)));
  const pressed = useSyncExternalStore(filter.subscribe, filter.pressed);
  const filterView = useMemo(() => ({ pressed, clear: filter.clear, touch: filter.touch }), [pressed, filter]);
  // The Household's Profiles, read here (and again when they change) for the people strip and for the colour of every event, and handed
  // to every calendar view, the Routines reader below and the Add event sheet: the Wall has no other reader of them.
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
      if ('household' in outcome) rememberHousehold(deviceStorage(), outcome.household);
      setView((prev) => householdViewAfter(prev, outcome));
      // After a failed read retry sooner, so Up next appears once the connection is back.
      timer = setTimeout(() => void read(), 'household' in outcome ? HOUSEHOLD_REFRESH_MS : HOUSEHOLD_RETRY_MS);
    }

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [householdChanges]);
  const timezone = view.household?.timezone ?? null;
  // How many days and Up next tiles Home holds at this screen's size, and whether the screen is a phone (below 768 px wide), which
  // swaps the chrome below and follows the phone's own light or dark setting.
  const home = useHomeLayout();
  // The Add event sheet is the layout's, so it closes when the layout swaps (a window resized across 768 px).
  useEffect(() => setAdding(false), [home.phone, home.portrait]);
  // The Household's weather, read once here for the header and every calendar view: nothing, and no
  // request, while it has no place. `weatherOn` is that fact, so the day headings can keep a line for it.
  // `sun` is what the mode goes on besides the Household: the forecast's sunrise and sunset.
  const { forecast, sun } = useForecast(view.household);
  const weatherOn = view.household !== null && view.household.weather_place !== null;
  // The mode of the screen: the Household's Appearance (Auto is light from sunrise to sunset, or from 7:00 to 19:00 in the
  // Household Timezone with no forecast), or what the screen last had while it cannot say: the Household not read yet, or
  // Auto waiting for the forecast's first read. The switch works as soon as the Household is read.
  // On the phone layout it is the phone's own setting instead, which reads and writes nothing the Wall stored, and has no switch.
  const toggleMode = useWallMode({ timezone, appearance: view.household?.appearance, sun, system: home.phone });
  // Today's Routines, read once for as long as the shell lives and handed to Up next on Home and to
  // the Routines chart, so going from one to the other reads nothing again and a tick in flight is not dropped.
  const routines = useRoutinesToday(timezone, profiles);

  const today = timezone ? householdDay(timezone).date : null;
  // The people strip is for the calendar screens (Home, Day, Week and Month), and for no other.
  const onCalendar = onCalendarScreen(route.view);
  const strip = onCalendar && <PeopleStrip profiles={profiles} routines={routines} filter={filter} pressed={pressed} />;
  // The Add event sheet, the same on both layouts.
  const sheet = adding && timezone && today && (
    <NativeEventSheet
      timezone={timezone}
      profiles={profiles ?? []}
      // The day the wall is on: today when the page shown holds it, else that page's first day.
      date={wallDate(route, today)}
      onClose={() => setAdding(false)}
      onSaved={() => {
        setAdding(false);
        setAdded((count) => count + 1);
      }}
    />
  );

  // The phone: a header, one column and five tabs. Everything above is shared with the tablet, so a resize across 768 px keeps the
  // route, the Profile filter and what has been read; only the chrome is drawn differently.
  if (home.phone) {
    return (
      <ProfileFilterContext.Provider value={filterView}>
        <PhoneShell
          owner={owner}
          route={route}
          household={view.household}
          today={today}
          forecast={forecast}
          strip={strip}
          onOpen={openView}
          onHome={openHome}
          onRoutines={openRoutines}
          onMeals={() => openMeals(null)}
          onLists={openLists}
          onAdd={() => setAdding(true)}
        >
          <PhoneWall
            route={route}
            timezone={timezone}
            view={view}
            added={added}
            forecast={forecast}
            weatherOn={weatherOn}
            profiles={profiles}
            routines={routines}
            openView={openView}
            openRoutines={openRoutines}
            openLists={openLists}
            openMeals={openMeals}
          />
        </PhoneShell>
        {sheet}
      </ProfileFilterContext.Provider>
    );
  }

  return (
    <WallFrame
      rail={
        <NavigationRail
          owner={owner}
          route={route}
          timezone={timezone}
          onOpen={openView}
          onHome={openHome}
          onRoutines={openRoutines}
          onMeals={() => openMeals(null)}
          onLists={openLists}
          onAdd={() => setAdding(true)}
          onToggleMode={toggleMode}
        />
      }
      header={
        <>
          <WallHeader household={view.household} today={today} forecast={forecast} onMeals={route.view === 'meals' ? null : () => openMeals(null)} />
        </>
      }
      strip={strip}
    >
      <ProfileFilterContext.Provider value={filterView}>
        {route.view === 'routines' ? (
          timezone ? (
            <RoutinesChart routines={routines} />
          ) : (
            // The chart before the Household is read: a frame that says "Loading", or that the read failed, as Up next does.
            <section aria-label="Routines" className="rounded-3xl bg-card p-4">
              {view.failed ? (
                <p role="alert" className="text-base">
                  Could not load routines. Check your connection.
                </p>
              ) : (
                <EmptyWords>Loading</EmptyWords>
              )}
            </section>
          )
        ) : route.view === 'meals' ? (
          // Meals is a screen of its own, not a calendar view: it takes the same slot, and before the Household is read it is an empty frame, or says it could not be read.
          timezone ? (
            <MealsScreen timezone={timezone} date={route.date} onNavigate={openMeals} portrait={home.portrait} />
          ) : (
            <BeforeHousehold label="Meals" failed={view.failed} words="Could not load meals. Check your connection." />
          )
        ) : route.view === 'lists' ? (
          // Lists is a screen of its own and reads no date, so it needs no Household Timezone to open.
          <ListsScreen portrait={home.portrait} />
        ) : route.view !== 'home' && timezone ? (
          <PagedCalendar timezone={timezone} view={route.view} date={route.date} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} profiles={profiles} portrait={home.portrait} />
        ) : route.view !== 'home' ? (
          // A calendar page before the Household is read: the empty calendar alone, not the home layout
          // under a navigation rail entry that marks Day, Week or Month.
          <BeforeHousehold label="Calendar" failed={view.failed} words="Could not load the calendar. Check your connection." />
        ) : (
        <div className={homeGrid(home.portrait)}>
          {timezone ? (
            <FiveDayCalendar timezone={timezone} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} profiles={profiles} days={home.days} />
          ) : (
            <BeforeHousehold label="Calendar" failed={view.failed} words="Could not load the calendar. Check your connection." />
          )}
          <HomeRail routines={routines} failed={view.failed} tiles={home.tiles} row={home.portrait} onOpenRoutines={openRoutines} onOpenLists={openLists} />
        </div>
        )}
        {sheet}
      </ProfileFilterContext.Provider>
    </WallFrame>
  );
}

// The Wall's frame: the navigation rail at the left, the header over the screen, and the screen (the one <main>) in the grid's second row.
// The header is outside the main, so it is the page's banner (a <header> inside a <main> is not one), and the people strip under it is a region. The main takes no box of its own
// (`contents`), so what it holds is laid out by the grid as if it were not there.
export function WallFrame({ rail, header, strip, children }: { rail: ReactNode; header: ReactNode; strip?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid h-svh min-h-[34rem] grid-cols-[min(6rem,max(96px,12vw))_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4 p-4">
      {rail}
      <div className="flex min-w-0 flex-col gap-3">
        {header}
        {/* The people strip, on the calendar screens, is a region of its own: outside the banner and the main it would be in no landmark. */}
        {strip && <section aria-label="People">{strip}</section>}
      </div>
      <main className="contents">{children}</main>
    </div>
  );
}
