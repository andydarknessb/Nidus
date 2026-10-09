import { describe, expect, it } from 'vitest';
import { mealPlan, mealsPickedDay, NOTHING_PLANNED, slotRowName } from '../src/lib/meal-plan';
import type { Meal } from '../src/lib/meals';
import { pagedView, pagingWindowAround } from '../src/lib/paged-view';
import { addDays, dayStartMs, householdDay } from '../supabase/functions/_shared/zoned-time.ts';

// The Meal Plan's core (CONTEXT.md: Meal Plan): the week, the day a phone has picked, and what a cell is, as plain functions with no
// screen and no database. The markup each screen draws from them is tests/wall-screens.test.ts and tests/phone-meals-lists.test.ts.

const LA = 'America/Los_Angeles';
const WEEK = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
const oatmeal: Meal = { id: 'm1', meal_date: '2026-10-01', slot: 'breakfast', title: 'Oatmeal' };

// The page the screen is on at `at`, as the hook lays it out: from the start of the Household's today.
function plan(at: string, { date = null, choice = null, meals = [], timezone = LA }: { date?: string | null; choice?: string | null; meals?: Meal[] | null; timezone?: string } = {}) {
  const today = householdDay(timezone, new Date(at)).date;
  return mealPlan({ page: pagedView('week', date, new Date(dayStartMs(today, timezone)), timezone), choice, meals });
}

describe('the week', () => {
  it("is the seven days from the Sunday of today's week, today marked, with the words for it", () => {
    const week = plan('2026-10-01T20:00:00Z');
    expect(week.days.map((day) => day.date)).toEqual(WEEK);
    expect(week.today).toBe('2026-10-01');
    expect(week.days.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-10-01']);
    expect(week.words).toBe('Sep 27 to Oct 3');
    expect(week.limit).toBe('');
    expect(week.previous).toBe('2026-09-20');
    expect(week.next).toBe('2026-10-04');
  });

  it('names the year only when the week is not in the Household’s current year', () => {
    expect(plan('2026-10-01T20:00:00Z', { date: '2026-12-27' }).words).toBe('Dec 27, 2026 to Jan 2, 2027');
  });

  it('says where the plan ends at each end of the window, and has no page beyond it', () => {
    const today = householdDay(LA, new Date('2026-10-01T20:00:00Z')).date;
    const window = pagingWindowAround(today);
    const first = plan('2026-10-01T20:00:00Z', { date: window.first });
    expect(first.previous).toBeNull();
    expect(first.limit).toBe('This is as far back as the meal plan goes.');
    const last = plan('2026-10-01T20:00:00Z', { date: window.last });
    expect(last.next).toBeNull();
    expect(last.limit).toBe('This is as far ahead as the meal plan goes.');
  });

  it('follows the Household’s midnight, not the machine’s or UTC’s', () => {
    // 06:59 UTC on 4 October is 23:59 on 3 October in Los Angeles (still the week of the 27th); 07:00 UTC is midnight, the next week.
    expect(plan('2026-10-04T06:59:00Z').days[0]!.date).toBe('2026-09-27');
    expect(plan('2026-10-04T07:00:00Z').days[0]!.date).toBe('2026-10-04');
  });
});

describe('the picked day', () => {
  // The Household's today at an instant, as the screen has it (useHouseholdDay).
  const picked = (choice: string | null, at: string, timezone = LA, week: readonly string[] = WEEK) => mealsPickedDay(week, choice, householdDay(timezone, new Date(at)).date);

  it('is today when the week holds it, and the Sunday when it does not', () => {
    expect(picked(null, '2026-10-01T20:00:00Z')).toBe('2026-10-01');
    expect(picked(null, '2026-10-12T20:00:00Z')).toBe('2026-09-27');
    expect(picked(null, '2026-09-20T20:00:00Z')).toBe('2026-09-27');
  });

  it('keeps the day chosen while it is in the week, and resets when the week changes', () => {
    expect(picked('2026-09-29', '2026-10-01T20:00:00Z')).toBe('2026-09-29');
    const nextWeek = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    // A choice made in the week before is no choice here: today's week would open on today, any other on its Sunday.
    expect(picked('2026-09-29', '2026-10-01T20:00:00Z', LA, nextWeek)).toBe('2026-10-04');
    expect(picked('2026-09-29', '2026-10-05T20:00:00Z', LA, nextWeek)).toBe('2026-10-05');
  });

  it("turns over at the Household's midnight, not the machine's or UTC's", () => {
    // 06:59 UTC on 4 October is 23:59 on 3 October in Los Angeles (still in the week); 07:00 UTC is midnight, the next week.
    expect(picked(null, '2026-10-04T06:59:00Z')).toBe('2026-10-03');
    expect(picked(null, '2026-10-04T07:00:00Z')).toBe('2026-09-27');
    // Auckland is UTC+13 in October: midnight on 4 October there is 11:00 UTC on the 3rd.
    expect(picked(null, '2026-10-03T10:59:00Z', 'Pacific/Auckland')).toBe('2026-10-03');
    expect(picked(null, '2026-10-03T11:00:00Z', 'Pacific/Auckland')).toBe('2026-09-27');
  });

  it('turns over at Household midnight on the day the clocks go back', () => {
    // Los Angeles goes back on 2026-11-01: midnight that day is still PDT, so 07:00Z is its start, and 06:59Z is the evening before.
    const week = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    const before = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
    expect(householdDay(LA, new Date('2026-11-01T07:00:00Z')).date).toBe('2026-11-01');
    expect(householdDay(LA, new Date('2026-10-31T06:59:00Z')).date).toBe('2026-10-30');
    expect(householdDay(LA, new Date('2026-11-01T06:59:00Z')).date).toBe('2026-10-31');
    expect(picked(null, '2026-11-01T07:00:00Z', LA, week)).toBe('2026-11-01');
    expect(picked(null, '2026-11-01T06:59:00Z', LA, week)).toBe('2026-11-01');
    expect(picked(null, '2026-11-01T06:59:00Z', LA, before)).toBe('2026-10-31');
    expect(picked(null, '2026-11-01T07:00:00Z', LA, before)).toBe('2026-10-25');
  });

  it('is the plan’s own day for the choice made, today otherwise, over Household midnight', () => {
    expect(plan('2026-10-01T20:00:00Z').picked.date).toBe('2026-10-01');
    expect(plan('2026-10-01T20:00:00Z', { choice: '2026-09-29' }).picked.date).toBe('2026-09-29');
    expect(plan('2026-10-04T06:59:00Z').picked.date).toBe('2026-10-03');
    expect(plan('2026-10-04T07:00:00Z').picked.date).toBe('2026-10-04');
    // A week that is not today's opens on its Sunday.
    expect(plan('2026-10-01T20:00:00Z', { date: '2026-10-11' }).picked.date).toBe('2026-10-11');
  });
});

describe('a cell', () => {
  const week = (meals: Meal[] | null) => plan('2026-10-01T20:00:00Z', { meals });
  const thursday = (meals: Meal[] | null) => week(meals).days[4]!;

  it('holds the Meal planned there, null when nothing is, and undefined while the Meals are not read', () => {
    const planned = week([oatmeal]);
    expect(planned.cellFor(thursday([oatmeal]), 'breakfast').meal).toEqual(oatmeal);
    expect(planned.cellFor(thursday([oatmeal]), 'dinner').meal).toBeNull();
    expect(planned.cellFor(planned.days[3]!, 'breakfast').meal).toBeNull();
    expect(week(null).cellFor(thursday(null), 'breakfast').meal).toBeUndefined();
  });

  it('is heard in full: the slot, the day and what it holds', () => {
    const planned = week([oatmeal]);
    const day = planned.days[4]!;
    expect(planned.cellFor(day, 'breakfast').heard).toBe('Breakfast, Thursday 1: Oatmeal');
    expect(planned.cellFor(day, 'snack').heard).toBe(`Snack, Thursday 1: ${NOTHING_PLANNED}`);
    expect(NOTHING_PLANNED).toBe('nothing planned. Add a meal');
  });

  it('is heard as the slot and the day alone until the Meals are read, so it never invites a write over a Meal not read yet', () => {
    const unread = week(null);
    expect(unread.cellFor(unread.days[4]!, 'breakfast').heard).toBe('Breakfast, Thursday 1');
  });

  it('says what precedes the Meal’s own words, for a cell that draws them itself', () => {
    const planned = week([oatmeal]);
    const day = planned.days[4]!;
    expect(planned.cellFor(day, 'breakfast').lead).toBe('Breakfast, Thursday 1: ');
    expect(week(null).cellFor(day, 'breakfast').lead).toBe('Breakfast, Thursday 1');
  });

  it("opens a sheet on its date and slot, titled short, with the Meal it holds", () => {
    const planned = week([oatmeal]);
    const day = planned.days[4]!;
    expect(planned.cellFor(day, 'breakfast').sheet).toEqual({ date: '2026-10-01', slot: 'breakfast', heading: 'Breakfast, Thu 1', meal: oatmeal });
    expect(planned.cellFor(day, 'snack').sheet).toEqual({ date: '2026-10-01', slot: 'snack', heading: 'Snack, Thu 1', meal: null });
  });

  it('reads the date of the day it is given, whatever the week', () => {
    const later = plan('2026-10-01T20:00:00Z', { date: '2026-10-11', meals: [{ id: 'm9', meal_date: '2026-10-14', slot: 'lunch', title: 'Soup' }] });
    expect(later.cellFor(later.days[3]!, 'lunch').meal?.title).toBe('Soup');
    expect(later.cellFor(later.days[3]!, 'lunch').sheet.date).toBe(addDays('2026-10-11', 3));
  });
});

describe('what a slot row is called', () => {
  it('is its slot, day and what it holds, in words', () => {
    expect(slotRowName('Breakfast', 'Thursday 1', oatmeal)).toBe('Breakfast, Thursday 1: Oatmeal');
    expect(slotRowName('Breakfast', 'Thursday 1', null)).toBe('Breakfast, Thursday 1: nothing planned. Add a meal');
    expect(slotRowName('Breakfast', 'Thursday 1', undefined)).toBe('Breakfast, Thursday 1');
  });
});
