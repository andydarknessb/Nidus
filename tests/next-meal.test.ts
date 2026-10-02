import { describe, expect, it } from 'vitest';
import { nextMeal, nextMealWords, type Meal, type MealSlot } from '../src/lib/meals';

// Which Meal the header offers next. Pure: the Household's time and the Meals read for it, so nothing here needs the
// database, and every instant is named with its own offset, never read from the machine.
const CHICAGO = 'America/Chicago';

// Wall-clock instants in Chicago on 2026-10-01 (CDT, UTC-5).
const at = (clock: string) => new Date(`2026-10-01T${clock}-05:00`);

const meal = (slot: MealSlot, title: string = slot, meal_date = '2026-10-01'): Meal => ({ id: `${meal_date}/${slot}`, meal_date, slot, title });
const planned = (...slots: MealSlot[]) => slots.map((slot) => meal(slot));
const titleAt = (meals: Meal[], now: Date, timezone = CHICAGO) => nextMeal(meals, now, timezone)?.title ?? null;

describe('the next meal', () => {
  const all = planned('breakfast', 'lunch', 'dinner', 'snack');

  it('is breakfast until 10:00, lunch until 14:00, a snack until 17:00, then dinner', () => {
    const slotAt = (clock: string) => titleAt(all, at(clock));
    expect([slotAt('00:00'), slotAt('09:59:59.999')]).toEqual(['breakfast', 'breakfast']);
    expect([slotAt('10:00'), slotAt('13:59:59.999')]).toEqual(['lunch', 'lunch']);
    expect([slotAt('14:00'), slotAt('16:59:59.999')]).toEqual(['snack', 'snack']);
    expect([slotAt('17:00'), slotAt('23:59:59.999')]).toEqual(['dinner', 'dinner']);
  });

  it('takes the first planned slot that is still ahead, in the order the day happens', () => {
    // The plan lists dinner before the snack, but the snack comes first in the day.
    expect(titleAt(planned('dinner', 'snack'), at('12:00'))).toBe('snack');
    expect(titleAt(planned('lunch', 'dinner'), at('08:00'))).toBe('lunch');
    expect(titleAt(planned('dinner'), at('08:00'))).toBe('dinner');
    // A slot that has gone by is behind, planned or not.
    expect(titleAt(planned('breakfast', 'dinner'), at('12:00'))).toBe('dinner');
    expect(titleAt(planned('breakfast', 'lunch', 'snack'), at('14:00'))).toBe('snack');
  });

  it('is nothing when no slot that is still ahead is planned', () => {
    expect(titleAt([], at('08:00'))).toBeNull();
    expect(titleAt(planned('breakfast', 'lunch', 'snack'), at('17:00'))).toBeNull();
    expect(titleAt(planned('breakfast'), at('10:00'))).toBeNull();
  });

  it('keeps dinner until Household midnight, when the next day takes over', () => {
    const dinner = planned('dinner');
    expect(titleAt(dinner, at('23:59:59.999'))).toBe('dinner');
    // Midnight: 2026-10-02 begins, and a dinner planned for the day before is not today's.
    expect(titleAt(dinner, new Date('2026-10-02T00:00:00-05:00'))).toBeNull();
    // What was planned for the new day is now today's, from its first minute.
    const tomorrow = [meal('breakfast', 'Toast', '2026-10-02')];
    expect(titleAt([...dinner, ...tomorrow], new Date('2026-10-02T00:00:00-05:00'))).toBe('Toast');
  });

  it('counts only the Meals of the Household date, never another day', () => {
    const elsewhere = [meal('dinner', 'Yesterday', '2026-09-30'), meal('dinner', 'Tomorrow', '2026-10-02'), meal('lunch', 'Last week', '2026-09-24')];
    expect(titleAt(elsewhere, at('08:00'))).toBeNull();
    expect(titleAt([...elsewhere, meal('dinner', 'Tacos')], at('08:00'))).toBe('Tacos');
  });

  it('returns the Meal itself, so the header can name its slot and its words', () => {
    expect(nextMeal([meal('dinner', 'Tacos')], at('18:00'), CHICAGO)).toEqual({ id: '2026-10-01/dinner', meal_date: '2026-10-01', slot: 'dinner', title: 'Tacos' });
  });

  it('reads the time in the Household Timezone, not the machine\'s', () => {
    // One instant: 7:30 PM on Oct 1 in Chicago, 9:30 AM on Oct 2 in Tokyo.
    const instant = new Date('2026-10-02T00:30:00Z');
    const meals = [meal('dinner', 'Tacos', '2026-10-01'), meal('breakfast', 'Toast', '2026-10-02'), meal('lunch', 'Soup', '2026-10-02')];
    expect(titleAt(meals, instant, CHICAGO)).toBe('Tacos');
    expect(titleAt(meals, instant, 'Asia/Tokyo')).toBe('Toast');
    // Half an hour on, it is 10:00 in Tokyo and breakfast has gone, while Chicago has only moved on to 8:00 PM.
    const later = new Date('2026-10-02T01:00:00Z');
    expect(titleAt(meals, later, 'Asia/Tokyo')).toBe('Soup');
    expect(titleAt(meals, later, CHICAGO)).toBe('Tacos');
  });

  it('follows the wall clock on the days the clocks change', () => {
    // Clocks go back on 2026-11-01: 10:00 is 16:00 UTC (CST, UTC-6), not 15:00.
    const back = [meal('breakfast', 'breakfast', '2026-11-01'), meal('lunch', 'lunch', '2026-11-01')];
    expect(titleAt(back, new Date('2026-11-01T15:59:59Z'))).toBe('breakfast');
    expect(titleAt(back, new Date('2026-11-01T16:00:00Z'))).toBe('lunch');
    // Clocks go forward on 2027-03-14: 10:00 is 15:00 UTC (CDT, UTC-5), not 16:00.
    const forward = [meal('breakfast', 'breakfast', '2027-03-14'), meal('lunch', 'lunch', '2027-03-14')];
    expect(titleAt(forward, new Date('2027-03-14T14:59:59Z'))).toBe('breakfast');
    expect(titleAt(forward, new Date('2027-03-14T15:00:00Z'))).toBe('lunch');
  });
});

describe('the words that name the next meal', () => {
  it('say tonight for dinner and today for the rest', () => {
    expect((['breakfast', 'lunch', 'dinner', 'snack'] as const).map(nextMealWords)).toEqual(['Breakfast today', 'Lunch today', 'Dinner tonight', 'Snack today']);
  });
});
