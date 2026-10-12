import { CalendarDays, CircleCheck, House, List, Plus, Settings, Utensils, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { navigationRailDate, type WallRoute } from '../lib/wall-routes';
import { dateWords } from '../../supabase/functions/_shared/event-words.ts';
import type { CalendarView } from '../lib/paged-view';
import type { Household } from '../lib/household';
import { useNow } from '../lib/wall-hooks';
import type { Forecast } from '../lib/weather';
import { ConnectionBadge } from './ConnectionBadge';
import { Button } from './ui/button';
import { SyncBadge } from './WallHeader';
import { WeatherNow } from './Weather';
import { householdDay } from '../../supabase/functions/_shared/zoned-time.ts';

// The Wall on a phone (docs/specs/0004-the-wall-on-a-phone.md; docs/look.md, "The phone"): below 768 px wide the navigation
// rail and the landscape grid give way to a header, one column that the document scrolls (no box inside it, so the phone's own
// gestures work), a round Add event button and five tabs at the foot. HomeShell keeps every piece of shared state and hands this
// only what the chrome draws; the screen in the column is the children (src/PhoneWall.tsx chooses it by route), and the people
// strip is `strip`, drawn at the top of the column on the calendar screens.

// How tall the tab bar is: its 56 px tabs, 8 px above them and 16 below (the phone's safe area comes on top of that), and the hairline over it.
const BAR = '5rem + 1px';
// Add event sits 16 px above the bar, which keeps the phone's bottom safe area clear.
const ADD_BOTTOM = `calc(${BAR} + 1rem + env(safe-area-inset-bottom))`;
// The status line sits above Add event (the button is 3.5 rem), so that it never covers it: 8 px of air over the button.
const STATUS_FOOT = `calc(${BAR} + 1rem + 3.5rem + 0.5rem + env(safe-area-inset-bottom))`;
// The column's foot: the bar, 16 px, the button and 16 px more, so nothing ends under either. On a phone on its side (the document's
// data-phone is "side": under 544 px tall by the held layout, src/lib/home-layout.ts, so the keyboard does not do it) the column also
// keeps 88 px clear at its right (16, the button, 16), since the screen is too short to scroll a pager's Next or a list's plus out from
// under Add event.
const COLUMN_FOOT = `calc(${BAR} + 1rem + 3.5rem + 1rem + env(safe-area-inset-bottom))`;

// A tab: an icon at 24 over its word at 14, 56 tall, radius 14. Below 380 px wide the word's letters are a little closer (tracking-tight), so that "Calendar" clears the 2 px ring of the
// Selected look at 360 px, where a tab is 67 px wide. The current one says so with `aria-current`, which is also what
// draws the Selected look, so it never rests on colour alone.
function Tab({ icon: Icon, label, current = false, ...props }: { icon: LucideIcon; label: string; current?: boolean } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Button variant="quiet" aria-current={current ? 'page' : undefined} className="h-14 min-w-fit flex-1 flex-col gap-0.5 rounded-[14px] px-0 text-sm font-medium whitespace-normal max-[380px]:tracking-tight" {...props}>
      <Icon aria-hidden className="size-6" />
      {label}
    </Button>
  );
}

// The tab bar: Home, Calendar, Routines, Meals and Lists. Calendar holds Day, Week and Month, so it is current on all three, and it
// opens Week on the date the Wall is on (navigationRailDate, as the navigation rail's Day, Week and Month do, read at the tap so
// one just after Household midnight is right). It waits for the Household Timezone, as the rail's calendar entries do; the others
// open at once. The five are 4 px apart, so each is about 72 px wide at 390 px.
export function PhoneTabs({
  route,
  timezone,
  onOpen,
  onHome,
  onRoutines,
  onMeals,
  onLists,
}: {
  route: WallRoute;
  timezone: string | null;
  onOpen: (view: CalendarView, date: string) => void;
  onHome: () => void;
  onRoutines: () => void;
  onMeals: () => void;
  onLists: () => void;
}) {
  const onCalendar = route.view === 'day' || route.view === 'week' || route.view === 'month';
  // At larger text the five tabs are wider than the screen and the bar scrolls sideways: the current tab is brought into view, so the bar
  // never opens with the tab that says where you are out of sight.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    bar.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route.view]);
  return (
    <nav ref={bar} aria-label="Wall sections" className="fixed inset-x-0 bottom-0 z-20 flex gap-1 overflow-x-auto overscroll-x-contain border-t border-border bg-card px-1 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Tab icon={House} label="Home" current={route.view === 'home'} onClick={onHome} />
      <Tab
        icon={CalendarDays}
        label="Calendar"
        current={onCalendar}
        disabled={!timezone}
        onClick={() => timezone && onOpen('week', navigationRailDate('week', route, householdDay(timezone).date))}
      />
      <Tab icon={CircleCheck} label="Routines" current={route.view === 'routines'} onClick={onRoutines} />
      <Tab icon={Utensils} label="Meals" current={route.view === 'meals'} onClick={onMeals} />
      <Tab icon={List} label="Lists" current={route.view === 'lists'} onClick={onLists} />
    </nav>
  );
}

// The Household's name over the date, in the Household Timezone: useNow redraws it at Household midnight, so the date turns with
// no reload. No clock: the phone has one. The date never shrinks: the block is never narrower than it, and the name, which has no
// width of its own (size containment keeps it out of the block's least width), is what ends in an ellipsis when the row is short.
function NameAndDate({ name, timezone }: { name: string; timezone: string }) {
  const now = useNow(timezone).getTime();
  return (
    <div className="flex min-w-min flex-1 flex-col">
      <h1 className="truncate text-[13px] leading-4 font-medium text-muted-foreground [contain:inline-size]">{name}</h1>
      <p className="font-display text-[26px] leading-8 whitespace-nowrap">{dateWords.day(now, timezone)}</p>
    </div>
  );
}

// The phone's header: one row 56 tall. The Household's name over the date, the weather now, Offline and stale sync as the tablet's
// small pills, and for the Household Account only a 48 px round gear that goes where the navigation rail's Settings link goes, the
// same way. A Device is never offered a way into administration, and there is no clock and no next meal (Meals is a tab).
//
// `sync` is what the stale-sync mark holds before its first read lands, which only a test gives it.
export function PhoneHeader({
  household,
  today,
  forecast,
  owner,
  sync,
}: {
  household: Household | null;
  today: string | null;
  forecast: Forecast | null;
  owner: boolean;
  sync?: ComponentProps<typeof SyncBadge>['initial'];
}) {
  const timezone = household?.timezone ?? null;
  return (
    <header className="group/header mt-4 flex h-14 items-center gap-1.5 px-4">
      {timezone ? <NameAndDate name={household?.name ?? ''} timezone={timezone} /> : <div className="flex-1" />}
      {household && today && <WeatherNow forecast={forecast} unit={household.temperature_unit} today={today} phone />}
      <ConnectionBadge phone />
      <SyncBadge compact initial={sync} />
      {owner && (
        <Button asChild variant="quiet" className="size-12 rounded-full bg-card p-0">
          <a href="/settings" aria-label="Settings">
            <Settings aria-hidden className="size-6" />
          </a>
        </Button>
      )}
    </header>
  );
}

// The shell: the header, the column and, fixed over it, Add event and the tab bar. The column is 16 px gutters with room at its
// foot for the bar and the button. Add event is the screen's one primary action, a 56 px round button on every tab, for the
// Household Account and a Device alike; it waits for the Household Timezone, as the rail's does. While the shell is up it tells
// the status line how far up its foot is (--status-foot, StatusLine.tsx), so a line said over the column is above the button.
export function PhoneShell({
  owner,
  route,
  household,
  today,
  forecast,
  strip,
  onOpen,
  onHome,
  onRoutines,
  onMeals,
  onLists,
  onAdd,
  children,
}: {
  owner: boolean;
  route: WallRoute;
  household: Household | null;
  today: string | null;
  forecast: Forecast | null;
  // The people strip, for the calendar screens; nothing elsewhere.
  strip: ReactNode;
  onOpen: (view: CalendarView, date: string) => void;
  onHome: () => void;
  onRoutines: () => void;
  onMeals: () => void;
  onLists: () => void;
  onAdd: () => void;
  children: ReactNode;
}) {
  const timezone = household?.timezone ?? null;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--status-foot', STATUS_FOOT);
    return () => void root.style.removeProperty('--status-foot');
  }, []);
  return (
    <>
      <PhoneHeader household={household} today={today} forecast={forecast} owner={owner} />
      <main className="flex min-w-0 flex-col gap-3 px-4 pt-3 [[data-phone=side]_&]:pr-22" style={{ paddingBottom: COLUMN_FOOT }}>
        {strip}
        {children}
      </main>
      <Button
        variant="primary"
        aria-label="Add event"
        aria-haspopup="dialog"
        disabled={!timezone}
        onClick={onAdd}
        className="fixed right-4 z-20 size-14 rounded-full p-0"
        style={{ bottom: ADD_BOTTOM }}
      >
        <Plus aria-hidden className="size-7" strokeWidth={2.6} />
      </Button>
      <PhoneTabs route={route} timezone={timezone} onOpen={onOpen} onHome={onHome} onRoutines={onRoutines} onMeals={onMeals} onLists={onLists} />
    </>
  );
}
