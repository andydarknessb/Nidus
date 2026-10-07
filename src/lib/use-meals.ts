import { Cookie, Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { WEEKDAYS } from './routines';
import { loadMeals, setMeal, type Meal, type MealSlot } from './meals';
import { supabase } from './supabase';
import { useSyncedRead } from './synced-read';
import type { WallDay } from './calendar-occurrences';

// The Meals reader as a hook, and how a day and a slot are named, for the Wall's Meals screen and the phone's (src/MealsPage.tsx,
// src/phone/PhoneMeals.tsx).

// What each read here listens to: a Meal changed anywhere in the Household.
const MEAL_TABLES = ['meals'] as const;

// The picture each slot is marked with, in the plan's rows and on the header's button.
export const SLOT_PICTURES: Record<MealSlot, LucideIcon> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };

// What one cell holds once `title` is saved in it: its Meal, or none for a blank title. A Meal not stored yet has an id that says so.
export function withMeal(meals: Meal[], date: string, slot: MealSlot, title: string): Meal[] {
  const others = meals.filter((meal) => meal.meal_date !== date || meal.slot !== slot);
  const kept = title.trim();
  return kept === '' ? others : [...others, { id: `pending-${date}-${slot}`, meal_date: date, slot, title: kept }];
}

// The Meals from `from` to `to` (Household dates), through the synced read: read again when a Meal changes anywhere in the Household,
// after each save made here, every 30 seconds, and 5 seconds after a failed read. `meals` is null until a read has landed; a failed
// read keeps what is shown. A turned page starts with nothing shown, so it never shows the last page's Meals. `save` plans or clears
// one cell, shown at once and taken back if it does not go through; it rejects as the write does.
export function useMeals(from: string, to: string): { meals: Meal[] | null; failed: boolean; save: (date: string, slot: MealSlot, title: string) => Promise<void> } {
  const read = useSyncedRead(() => loadMeals(supabase, from, to), MEAL_TABLES, `${from} ${to}`);
  const save = (date: string, slot: MealSlot, title: string) => read.write(() => setMeal(supabase, date, slot, title), (meals) => withMeal(meals, date, slot, title));
  return { meals: read.data, failed: read.failed, save };
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
