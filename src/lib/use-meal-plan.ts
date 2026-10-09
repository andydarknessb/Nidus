import { Cookie, Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { mealsPageDate } from './calendar-occurrences';
import { mealPlan } from './meal-plan';
import { loadMeals, nextMeal, setMeal, withMeal, type Meal, type MealSlot } from './meals';
import { MEAL_PLAN_LIMITS } from './paged-view';
import { supabase } from './supabase';
import { useSyncedRead } from './synced-read';
import { usePagedView } from './use-paged-view';
import { useHouseholdDay, useNow } from './wall-hooks';
import { dayStartMs, householdDay } from '../../supabase/functions/_shared/zoned-time.ts';

// The Meal Plan as a hook (meal-plan.ts has the rules), for the Wall's Meals screen and the phone's (src/MealsPage.tsx,
// src/phone/PhoneMeals.tsx).

// What each read here listens to: a Meal changed anywhere in the Household.
const MEAL_TABLES = ['meals'] as const;

// The picture each slot is marked with, in the plan's rows and on the header's button.
export const SLOT_PICTURES: Record<MealSlot, LucideIcon> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };

// The week `date` asks for (null for this week, which the screen then follows as the weeks turn) in the Household's `timezone`:
// its days, the pager, the Meals read through the synced read (read again when a Meal changes anywhere in the Household, after each
// save made here, every 30 seconds, and 5 seconds after a failed read), the day a phone has picked and each cell.
//
// `onNavigate` opens a week by its Sunday, or by null when it holds today, which a Wall left there then follows as the weeks turn.
// `focus` is how the page's title takes focus when a page turns (usePagedView): the Wall's takes it on arrival, the phone's never
// scrolls to it.
export function useMealPlan({
  timezone,
  date,
  onNavigate,
  focus,
}: {
  timezone: string;
  date: string | null;
  onNavigate: (date: string | null) => void;
  focus: { takesFocusOnArrival: boolean; preventScroll?: boolean };
}) {
  const today = useHouseholdDay(timezone).date;
  // The page is laid out from the start of today, so its days and the mark on today agree.
  const page = usePagedView({ view: 'week', date, now: new Date(dayStartMs(today, timezone)), timezone, limits: MEAL_PLAN_LIMITS, ...focus });
  const from = page.days[0]!.date;

  // The week each read was made for goes with it, so a turned page starts with nothing shown and never shows the last page's Meals (the
  // read is only cleared once the page has drawn).
  const read = useSyncedRead(async () => ({ from, meals: await loadMeals(supabase, from, page.days[6]!.date) }), MEAL_TABLES, from);
  const meals = read.data?.from === from ? read.data.meals : null;
  // Plans or clears one cell, shown at once and taken back if it does not go through; it rejects as the write does.
  const save = (day: string, slot: MealSlot, title: string) =>
    read.write(
      () => setMeal(supabase, day, slot, title),
      (shown) => ({ ...shown, meals: withMeal(shown.meals, day, slot, title) }),
    );

  // A day chosen holds for its week alone: another week starts again on today or its Sunday.
  const [chosen, setChosen] = useState<{ week: string; date: string } | null>(null);
  if (chosen && chosen.week !== from) setChosen(null);
  const plan = mealPlan({ page, choice: chosen?.week === from ? chosen.date : null, meals });

  const open = (week: string) => onNavigate(mealsPageDate(week, today));
  const { previous, next } = plan;
  return {
    ...plan,
    // The pager: each turn as the way to take it, or null beyond the limit; `heading` is the title's ref, which focus moves to.
    previous: previous === null ? null : () => open(previous),
    next: next === null ? null : () => open(next),
    heading: page.heading,
    // 'loading' until a read has landed, 'failed' when the first read did not (a later failure keeps what is shown), else 'ready'.
    state: meals !== null ? ('ready' as const) : read.failed ? ('failed' as const) : ('loading' as const),
    save,
    pick: (picked: string) => setChosen({ week: from, date: picked }),
  };
}

// The header's next meal (nextMeal): today's Meals alone, drawn again each minute and at Household midnight, and read again when a Meal
// changes anywhere in the Household. Null until they are read and when no slot ahead is planned.
export function useNextMeal(timezone: string): Meal | null {
  const now = useNow(timezone);
  const today = householdDay(timezone, now).date;
  const read = useSyncedRead(() => loadMeals(supabase, today, today), MEAL_TABLES, today);
  return read.data && nextMeal(read.data, now, timezone);
}
