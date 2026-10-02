import { Calendar1, CalendarDays, CalendarRange, ClipboardCheck, House, ListChecks, Plus, Settings, Utensils, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { navigationRailDate, type CalendarView, type WallRoute } from '../lib/calendar-occurrences';
import { householdDay } from '../lib/routines';

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

// The navigation rail down the left side: Home, Day, Week, Month, Routines, Meals and Lists, and at
// its foot Add event.
// Day, Week and Month keep the date the wall is on (navigationRailDate), read at the tap so one just after
// Household midnight is right, and wait for the Household Timezone. Meals always opens this week, with
// no date in its address, so it needs no Household Timezone to open. Lists opens the Lists screen over
// this one rather than going anywhere. Add event is an action, not a section: it is never the current
// entry, opens the Native Event sheet, and is drawn as the primary action. Above it, for a Household
// Account only, sits the link to Settings: a Device is never offered a way into administration. Its column is its whole
// width, border and padding included, and must stay at most 90 px: the five day columns at 1280 px need
// 140 px each. Its longest label, Add event, wraps onto two lines; Routines and Settings, the longest
// single words, fit on one.
export function NavigationRail({
  route,
  timezone,
  onOpen,
  onHome,
  onRoutines,
  onMeals,
  onLists,
  onAdd,
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
      <NavigationRailEntry icon={ClipboardCheck} label="Routines" current={route.view === 'routines'} onClick={onRoutines} />
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
