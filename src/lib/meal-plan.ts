import { mealGrid, type Meal, type MealSlot } from './meals';
import { limitWords, MEAL_PLAN_LIMITS, type PagedView, type WallDay } from './paged-view';
import { pageWords } from './phone-calendar';
import { WEEKDAYS } from './routines';

// The Meal Plan (CONTEXT.md): the Household's Meals for one week, as the Wall's Meals screen and the phone's both draw it. This is the
// plain core, with no screen and no database, so it is tested with a fixed `now` (tests/meal-plan.test.ts); use-meal-plan.ts is the hook
// that reads the Meals and holds the choice of day. The row rules (reading and writing a Meal, the grid, the next meal) are meals.ts.

// "Thu 1": a day as the grid names it, and "Thursday 1": the same in full, as a screen reader hears it.
export function dayLabel(day: WallDay): string {
  return `${WEEKDAYS[day.weekday]!.short} ${Number(day.date.slice(8))}`;
}
export function dayName(day: WallDay): string {
  return `${WEEKDAYS[day.weekday]!.name} ${Number(day.date.slice(8))}`;
}

// The day a phone's Meals screen has picked: the one chosen while it is in the week shown, else today when the week holds it, else the week's
// first day (its Sunday). `dates` are the week's Household dates and `today` the Household's own, so the pick follows Household midnight;
// a choice made in another week is no choice, which is how the pick resets when the week changes.
export function mealsPickedDay(dates: readonly string[], choice: string | null, today: string): string {
  if (choice !== null && dates.includes(choice)) return choice;
  return dates.includes(today) ? today : dates[0]!;
}

// What a slot's row says when there is no Meal in it, to a screen reader.
export const NOTHING_PLANNED = 'nothing planned. Add a meal';

// What a slot's row is called, as a screen reader hears it: "Breakfast, Thursday 1: Oatmeal", or "Breakfast, Thursday 1: nothing planned.
// Add a meal". While the Meals are not read (`meal` undefined) it is "Breakfast, Thursday 1" alone, since a row that looked empty and could
// be tapped would invite writing over a Meal that is only not read yet. `day` is the day in full and its date.
export function slotRowName(label: string, day: string, meal: Meal | null | undefined): string {
  const head = `${label}, ${day}`;
  if (meal === undefined) return head;
  return `${head}: ${meal ? meal.title : NOTHING_PLANNED}`;
}

// The cell a meal sheet opens on: its Household date and slot, how the sheet is titled (drawn short, "Breakfast, Thu 1"; the cell is heard
// in full) and the Meal it holds, if any.
export type MealSheetCell = { date: string; slot: MealSlot; heading: string; meal: Meal | null };

export type MealCell = {
  // The Meal planned in the cell, null when nothing is, and undefined while the Meals are not read.
  meal: Meal | null | undefined;
  // The whole name a screen reader hears (slotRowName).
  heard: string;
  // What of `heard` comes before the Meal's own words, for a cell that draws those itself: "Breakfast, Thursday 1: ", and the name alone
  // while the Meals are not read.
  lead: string;
  sheet: MealSheetCell;
};

export type MealPlan = {
  days: WallDay[];
  today: string;
  // The anchors of the weeks either side, null beyond the window the plan pages within.
  previous: string | null;
  next: string | null;
  // The sentence for a week at an end of that window, or '' between the ends.
  limit: string;
  // The week in words, the year only when it is not the Household's current one (the phone's title; the Wall's is the Calendar's).
  words: string;
  // The day a phone shows: the choice, else today, else the Sunday (mealsPickedDay). The Wall draws every day and ignores it.
  picked: WallDay;
  cellFor(day: WallDay, slot: MealSlot): MealCell;
};

// The plan for `page` (usePagedView, or pagedView at a fixed instant) given the day chosen on a phone (a Household date, or null) and the
// Meals read for the week (null until a read has landed).
export function mealPlan({ page, choice, meals }: { page: PagedView<'week'>; choice: string | null; meals: readonly Meal[] | null }): MealPlan {
  const { days, today } = page;
  const dates = days.map((day) => day.date);
  const picked = days[dates.indexOf(mealsPickedDay(dates, choice, today))]!;
  const grid = mealGrid([...(meals ?? [])], dates);
  return {
    days,
    today,
    previous: page.previous,
    next: page.next,
    limit: limitWords(page, MEAL_PLAN_LIMITS),
    words: pageWords(days, today),
    picked,
    cellFor(day, slot) {
      const row = grid.find((entry) => entry.slot === slot)!;
      const planned = row.cells[dates.indexOf(day.date)]!;
      const meal = meals === null ? undefined : planned;
      const heard = slotRowName(row.label, dayName(day), meal);
      const lead = meal === undefined ? heard : `${row.label}, ${dayName(day)}: `;
      return { meal, heard, lead, sheet: { date: day.date, slot, heading: `${row.label}, ${dayLabel(day)}`, meal: planned } };
    },
  };
}
