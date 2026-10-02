import type { SupabaseClient } from '@supabase/supabase-js';

// Meals (CONTEXT.md): what the Household plans to eat for one slot on one Household date, as free
// text. A Household Account (the phone) or a Device (the wall) writes them. Every function takes
// the client so the same code runs in the app and in tests, against the local stack.

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
