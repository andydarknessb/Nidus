import { Calendar1, CalendarDays, CalendarRange, CircleCheck, House, List, Moon, Plus, Settings, Sun, Utensils, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { navigationRailDate, type CalendarView, type WallRoute } from '../lib/calendar-occurrences';
import { householdDay } from '../lib/routines';
import { useMode } from '../lib/use-mode';
import { Button } from './ui/button';

// An entry's look, shared by the entries and the link to Settings: an icon over a word, at least 64 px tall and the
// rail's width, in the quiet voice. A word too long for one line wraps; the entry then grows taller, never wider.
const ENTRY = 'h-auto min-h-16 w-full flex-col gap-0.5 rounded-2xl px-0 text-sm font-medium whitespace-normal';

// One entry of the navigation rail. The current one says so with `aria-current`, which is also what draws it
// selected (a filled ground and a ring, and weight), so it never rests on colour alone.
function NavigationRailEntry({ icon: Icon, label, current = false, ...props }: { icon: LucideIcon; label: string; current?: boolean } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Button variant="quiet" aria-current={current ? 'page' : undefined} className={ENTRY} {...props}>
      <Icon aria-hidden className="size-6" />
      {label}
    </Button>
  );
}

// The navigation rail down the left side: Home, Day, Week, Month, Routines, Meals and Lists, and at its foot the
// switch between light and dark, the link to Settings and Add event.
// Day, Week and Month keep the date the wall is on (navigationRailDate), read at the tap so one just after
// Household midnight is right, and wait for the Household Timezone. Meals always opens this week, with
// no date in its address, so it needs no Household Timezone to open. Lists opens the Lists screen over
// this one rather than going anywhere. The switch changes the mode on this screen until the next sunrise or
// sunset (it waits for the Household Timezone too, which says when that is). Add event is an action, not a
// section: it is never the current entry, opens the Native Event sheet, and is the primary action. Above them,
// for a Household Account only, sits the link to Settings: a Device is never offered a way into administration.
// The rail is 96 px wide, its padding included; with the Settings link its entries, switch and Add event
// need 724 of the 768 px the 800 px screen leaves it.
export function NavigationRail({
  route,
  timezone,
  onOpen,
  onHome,
  onRoutines,
  onMeals,
  onLists,
  onAdd,
  onToggleMode,
  owner,
}: {
  route: WallRoute;
  timezone: string | null;
  onOpen: (view: CalendarView, date: string) => void;
  onHome: () => void;
  onRoutines: () => void;
  onMeals: () => void;
  onLists: () => void;
  onAdd: () => void;
  onToggleMode: () => void;
  owner: boolean;
}) {
  const mode = useMode();
  const open = (view: CalendarView) => {
    if (timezone) onOpen(view, navigationRailDate(view, route, householdDay(timezone).date));
  };
  return (
    <nav aria-label="Wall sections" className="row-span-2 flex flex-col gap-2 rounded-3xl bg-card p-2">
      <NavigationRailEntry icon={House} label="Home" current={route.view === 'home'} onClick={onHome} />
      <NavigationRailEntry icon={Calendar1} label="Day" current={route.view === 'day'} disabled={!timezone} onClick={() => open('day')} />
      <NavigationRailEntry icon={CalendarRange} label="Week" current={route.view === 'week'} disabled={!timezone} onClick={() => open('week')} />
      <NavigationRailEntry icon={CalendarDays} label="Month" current={route.view === 'month'} disabled={!timezone} onClick={() => open('month')} />
      <NavigationRailEntry icon={CircleCheck} label="Routines" current={route.view === 'routines'} onClick={onRoutines} />
      <NavigationRailEntry icon={Utensils} label="Meals" current={route.view === 'meals'} onClick={onMeals} />
      <NavigationRailEntry icon={List} label="Lists" aria-haspopup="dialog" onClick={onLists} />
      <div className="mt-auto flex flex-col gap-2.5">
        <Button
          aria-label={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}
          disabled={!timezone}
          onClick={onToggleMode}
          className="size-12 self-center rounded-full p-0"
        >
          {mode === 'dark' ? <Sun aria-hidden className="size-6" /> : <Moon aria-hidden className="size-6" />}
        </Button>
        {owner && (
          <Button asChild variant="quiet" className={ENTRY}>
            <a href="/settings">
              <Settings aria-hidden className="size-6" />
              Settings
            </a>
          </Button>
        )}
        <Button variant="primary" aria-haspopup="dialog" disabled={!timezone} onClick={onAdd} className="h-[72px] w-full flex-col gap-0.5 rounded-[20px] px-0 text-sm whitespace-normal">
          <Plus aria-hidden className="size-[26px]" strokeWidth={2.6} />
          Add event
        </Button>
      </div>
    </nav>
  );
}
