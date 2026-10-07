import type { SupabaseClient } from '@supabase/supabase-js';
import { householdDay, instantAt } from '../../supabase/functions/_shared/zoned-time.ts';

// Meals (CONTEXT.md): what the Household plans to eat for one slot on one Household date, as free
// text. A Household Account (the phone) or a Device (the wall) writes them. Every function that
// reads or writes takes the client so the same code runs in the app and in tests, against the
// local stack; the rest are pure.

// The slots of a day in the order the wall shows them, and the word each goes by.
export const MEAL_SLOTS = [
  { slot: 'breakfast', label: 'Breakfast' },
  { slot: 'lunch', label: 'Lunch' },
  { slot: 'dinner', label: 'Dinner' },
  { slot: 'snack', label: 'Snack' },
] as const;

export type MealSlot = (typeof MEAL_SLOTS)[number]['slot'];

// `meal_date` is a Household date: 'YYYY-MM-DD'.
export type Meal = { id: string; meal_date: string; slot: MealSlot; title: string };

const columns = 'id, meal_date, slot, title';

// The Meals from `from` to `to`, both Household dates and both included, in date order.
export async function loadMeals(client: SupabaseClient, from: string, to: string): Promise<Meal[]> {
  const { data, error } = await client.from('meals').select(columns).gte('meal_date', from).lte('meal_date', to).order('meal_date');
  if (error) throw error;
  return data as Meal[];
}

// Plans `slot` on `date`, a Household date, replacing what it held; a blank title clears it. One
// call, so two screens saving the same slot at once leave one Meal.
export async function setMeal(client: SupabaseClient, date: string, slot: MealSlot, title: string): Promise<void> {
  const { error } = await client.rpc('set_meal', { p_meal_date: date, p_slot: slot, p_title: title.trim() });
  if (error) throw error;
}

type MealRow = { slot: MealSlot; label: string; cells: (Meal | null)[] };

// The Meals as the grid draws them: a row for each slot in order, and in it one cell for each of
// `dates`, in the order given, holding that day's Meal or null where nothing is planned.
export function mealGrid(meals: Meal[], dates: string[]): MealRow[] {
  return MEAL_SLOTS.map(({ slot, label }) => ({
    slot,
    label,
    cells: dates.map((date) => meals.find((meal) => meal.meal_date === date && meal.slot === slot) ?? null),
  }));
}

// The slots in the order the day happens, which is not the grid's (the snack comes before dinner), each with the
// Household wall-clock time after which it is no longer ahead. Dinner has none: it stays until Household midnight,
// when the date turns over and the new day's Meals are the ones counted.
const DAY_SLOTS: readonly { slot: MealSlot; until: string | null }[] = [
  { slot: 'breakfast', until: '10:00' },
  { slot: 'lunch', until: '14:00' },
  { slot: 'snack', until: '17:00' },
  { slot: 'dinner', until: null },
];

// The Meal the header offers as the next one: the first planned slot of today (the Household date at `now`) that
// is still ahead, or null when none is. A slot is ahead until its time on the Household's own wall clock, so the
// clocks changing never moves it, and `meals` may be any read: only today's count.
export function nextMeal(meals: readonly Meal[], now: Date, timezone: string): Meal | null {
  const today = householdDay(timezone, now).date;
  for (const { slot, until } of DAY_SLOTS) {
    if (until !== null && now.getTime() >= instantAt(today, until, timezone)) continue;
    const planned = meals.find((meal) => meal.meal_date === today && meal.slot === slot);
    if (planned) return planned;
  }
  return null;
}

// What the header calls the next meal's slot: "Dinner tonight", "Lunch today".
export function nextMealWords(slot: MealSlot): string {
  const { label } = MEAL_SLOTS.find((entry) => entry.slot === slot)!;
  return slot === 'dinner' ? `${label} tonight` : `${label} today`;
}

// The day a phone's Meals screen has picked: the one chosen while it is in the week shown, else today when the week holds it, else the week's
// first day (its Sunday). `dates` are the week's Household dates and `today` the Household's own, so the pick follows Household midnight;
// a choice made in another week is no choice, which is how the pick resets when the week changes.
export function mealsPickedDay(dates: readonly string[], choice: string | null, today: string): string {
  if (choice !== null && dates.includes(choice)) return choice;
  return dates.includes(today) ? today : dates[0]!;
}

// What a slot's row is called on the phone, as a screen reader hears it: "Breakfast, Thursday 1: Oatmeal", or "Breakfast, Thursday 1:
// nothing planned. Add a meal". While the Meals are not read (`meal` undefined) it is "Breakfast, Thursday 1" alone, since a row that
// looked empty and could be tapped would invite writing over a Meal that is only not read yet. `day` is the day in full and its date.
export function slotRowName(label: string, day: string, meal: Meal | null | undefined): string {
  const head = `${label}, ${day}`;
  if (meal === undefined) return head;
  return `${head}: ${meal ? meal.title : 'nothing planned. Add a meal'}`;
}
