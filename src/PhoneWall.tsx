import type { ReactNode } from 'react';
import { BeforeHousehold } from './components/BeforeHousehold';
import { FiveDayCalendar, PagedCalendar } from './components/FiveDayCalendar';
import { HomeRail } from './components/HomeRail';
import type { CalendarView, WallRoute } from './lib/calendar-occurrences';
import type { HouseholdView } from './lib/household';
import type { Profile } from './lib/profiles';
import type { RoutinesToday } from './lib/use-routines-today';
import type { Forecast } from './lib/weather';
import { MealsScreen } from './MealsPage';
import { PhoneRoutines } from './phone/PhoneRoutines';
import { ListsScreen } from './SharedListsPage';

// The screen in the phone's column, chosen by the route (docs/specs/0004-the-wall-on-a-phone.md). HomeShell reads everything once and
// hands it down, so a phone screen reads nothing of its own that the tablet's does not: no reader, query or subscription is added here.
// Each route is one branch below, and each branch draws the tablet's own screen until the ticket for that screen lands; that ticket
// replaces its one branch with a screen under src/phone/ that takes these same props, and no other.

export type PhoneScreenProps = {
  route: WallRoute;
  // The Household Timezone; null until the Household is read.
  timezone: string | null;
  // The Household read, for a screen's "could not load" words.
  view: HouseholdView;
  // How many events the Add event sheet has saved, which makes the calendar read again at once.
  added: number;
  forecast: Forecast | null;
  weatherOn: boolean;
  // The Household's Profiles; null until read.
  profiles: Profile[] | null;
  // Today's Routines, read once by HomeShell.
  routines: RoutinesToday;
  // How many Up next tiles Home may show.
  tiles: number;
  openView: (view: CalendarView, date: string) => void;
  openRoutines: () => void;
  openLists: () => void;
  openMeals: (date: string | null) => void;
};

export function PhoneWall(props: PhoneScreenProps) {
  const { route } = props;
  switch (route.view) {
    case 'home': return <TabletHome {...props} />;
    case 'day': return <TabletCalendar {...props} route={route} />;
    case 'week': return <TabletCalendar {...props} route={route} />;
    case 'month': return <TabletCalendar {...props} route={route} />;
    case 'routines': return <PhoneRoutines {...props} />;
    case 'meals': return <TabletMeals {...props} route={route} />;
    case 'lists': return <TabletLists />;
  }
}

// ---- The tablet's screens, as the column holds them until their own tickets land ---------------------------------------------------

// The tablet's screens fill a box of the screen's height and scroll or page inside it. The document scrolls on the phone, so until a
// screen is made for the phone it is given such a box: at least as tall as it needs to be readable, else the height of the phone's
// screen under the header and the bar.
function Boxed({ children, className = 'h-[max(32rem,calc(100svh-17rem))]' }: { children: ReactNode; className?: string }) {
  return <div className={`relative flex min-h-0 min-w-0 flex-col overflow-x-clip ${className}`}>{children}</div>;
}

const COULD_NOT_LOAD = 'Could not load the calendar. Check your connection.';

// Home: the tablet's calendar, one day (today), then the right rail, stacked.
function TabletHome({ timezone, view, added, forecast, weatherOn, profiles, routines, tiles, openView, openRoutines, openLists }: PhoneScreenProps) {
  return (
    <>
      <Boxed>
        {timezone ? (
          <FiveDayCalendar timezone={timezone} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} profiles={profiles} days={1} />
        ) : (
          <BeforeHousehold label="Calendar" failed={view.failed} words={COULD_NOT_LOAD} />
        )}
      </Boxed>
      <Boxed className="h-[max(36rem,calc(100svh-12rem))]">
        <HomeRail routines={routines} failed={view.failed} tiles={tiles} onOpenRoutines={openRoutines} onOpenLists={openLists} />
      </Boxed>
    </>
  );
}

// Day, Week and Month: the tablet's paged calendar.
function TabletCalendar({ route, timezone, view, added, forecast, weatherOn, profiles, openView }: PhoneScreenProps & { route: Extract<WallRoute, { view: CalendarView }> }) {
  return (
    <Boxed>
      {timezone ? (
        <PagedCalendar timezone={timezone} view={route.view} date={route.date} version={added} onNavigate={openView} forecast={forecast} weatherOn={weatherOn} profiles={profiles} />
      ) : (
        <BeforeHousehold label="Calendar" failed={view.failed} words={COULD_NOT_LOAD} />
      )}
    </Boxed>
  );
}

// Meals: the tablet's week by slot.
function TabletMeals({ route, timezone, view, openMeals }: PhoneScreenProps & { route: Extract<WallRoute, { view: 'meals' }> }) {
  return (
    <Boxed>
      {timezone ? <MealsScreen timezone={timezone} date={route.date} onNavigate={openMeals} /> : <BeforeHousehold label="Meals" failed={view.failed} words="Could not load meals. Check your connection." />}
    </Boxed>
  );
}

// Lists: the tablet's screen, which reads no date and so needs no Household Timezone to open.
function TabletLists() {
  return (
    <Boxed>
      <ListsScreen />
    </Boxed>
  );
}
