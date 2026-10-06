import { Cookie, Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WEEKDAYS } from './routines';
import { useRefetchOn } from './change-feed';
import { loadMeals, type Meal, type MealSlot } from './meals';
import { startReadLoop, type ReadLoop } from './read-loop';
import { supabase } from './supabase';
import type { WallDay } from './calendar-occurrences';

// The Meals reader as a hook, and how a day and a slot are named, for the Wall's Meals screen and the phone's (src/MealsPage.tsx,
// src/phone/PhoneMeals.tsx).

// A change heard from the server reads at once; this slow read is the backstop for one that was
// missed while the connection was down. A read that failed is tried again sooner, as the calendar's is.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;
// What each read here listens to: a Meal changed anywhere in the Household.
const MEAL_TABLES = ['meals'] as const;

// The picture each slot is marked with, in the plan's rows and on the header's button.
export const SLOT_PICTURES: Record<MealSlot, LucideIcon> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };

// The Meals from `from` to `to` (Household dates), read again when a Meal changes anywhere in the
// Household, when `saves` goes up (a save made here) and every minute, or after five seconds when
// the last read failed. `meals` is null until a read has landed; a failed read keeps what is shown.
// Callers are keyed on the span, so a turned page never shows the last page's Meals.
export function useMeals(from: string, to: string, saves = 0): { meals: Meal[] | null; failed: boolean } {
  const [read, setRead] = useState<{ meals: Meal[] | null; failed: boolean }>({ meals: null, failed: false });
  // A change pokes the loop instead of restarting it, so a read in flight lands and one more follows.
  const loop = useRef<ReadLoop | null>(null);
  useRefetchOn(MEAL_TABLES, () => loop.current?.poke());
  useEffect(() => {
    loop.current = startReadLoop({
      read: () => loadMeals(supabase, from, to),
      onResult: (meals) => setRead({ meals, failed: false }),
      onFail: () => setRead((prev) => ({ ...prev, failed: true })),
      refreshMs: REFRESH_MS,
      retryMs: RETRY_MS,
    });
    return () => {
      loop.current?.stop();
      loop.current = null;
    };
  }, [from, to, saves]);
  return read;
}

// "Thu 1": a day as the grid names it, and "Thursday 1": the same in full, as a screen reader hears it.
export function dayLabel(day: WallDay): string {
  return `${WEEKDAYS[day.weekday]!.short} ${Number(day.date.slice(8))}`;
}
export function dayName(day: WallDay): string {
  return `${WEEKDAYS[day.weekday]!.name} ${Number(day.date.slice(8))}`;
}

// The cell a meal sheet opens on from a slot row: its Household date and slot, how the sheet is titled (drawn short, "Breakfast, Thu 1"; the
// row is heard in full) and the Meal it holds, if any.
export function sheetFor(day: WallDay, row: { slot: MealSlot; label: string }, meal: Meal | null): { date: string; slot: MealSlot; heading: string; meal: Meal | null } {
  return { date: day.date, slot: row.slot, heading: `${row.label}, ${dayLabel(day)}`, meal };
}
