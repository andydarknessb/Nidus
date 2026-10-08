import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pageDays } from '../src/lib/paged-view';
import { mealsPickedDay, slotRowName, type Meal } from '../src/lib/meals';
import { leftToGet, listChipName, pickedList, type SharedList } from '../src/lib/shared-lists';
import type { ListChip as ListChipType, PhoneLists as PhoneListsType } from '../src/phone/PhoneLists';
import type { PhoneMeals as PhoneMealsType, SlotRow as SlotRowType } from '../src/phone/PhoneMeals';
import type { PhoneScreenProps } from '../src/PhoneWall';
import type { sheetFor as sheetForType } from '../src/lib/use-meals';
import { householdDay } from '../supabase/functions/_shared/zoned-time.ts';

// The phone's Meals and Lists tabs: the picked day and the picked list as pure rules, and a slot row and a list chip as markup. How they
// sit in a 390 px column is looked at in a browser. Colours are tokens only, so the 7:1 pairs are look.test.ts's.

// These components import the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to
// load them (as tests/phone-home.test.ts does), so CI, which has no .env.local, loads them the same way.
let ListChip: typeof ListChipType;
let PhoneLists: typeof PhoneListsType;
let PhoneMeals: typeof PhoneMealsType;
let SlotRow: typeof SlotRowType;
let sheetFor: typeof sheetForType;
let thursday: ReturnType<typeof pageDays>[number];
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ ListChip, PhoneLists } = await import('../src/phone/PhoneLists'));
  ({ PhoneMeals, SlotRow } = await import('../src/phone/PhoneMeals'));
  ({ sheetFor } = await import('../src/lib/use-meals'));
  thursday = pageDays('week', '2026-10-01', LA, new Date('2026-10-01T12:00:00Z'))[4]!;
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const noop = () => undefined;
const LA = 'America/Los_Angeles';
const WEEK = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
const oatmeal: Meal = { id: 'm1', meal_date: '2026-10-01', slot: 'breakfast', title: 'Oatmeal' };

describe('mealsPickedDay', () => {
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
});

describe('what a slot row opens', () => {
  it("is the picked day and the row's slot, titled short, with the Meal it holds", () => {
    expect(sheetFor(thursday, { slot: 'breakfast', label: 'Breakfast' }, oatmeal)).toEqual({ date: '2026-10-01', slot: 'breakfast', heading: 'Breakfast, Thu 1', meal: oatmeal });
    expect(sheetFor(thursday, { slot: 'snack', label: 'Snack' }, null)).toEqual({ date: '2026-10-01', slot: 'snack', heading: 'Snack, Thu 1', meal: null });
  });
});

describe('leftToGet', () => {
  const items = [
    { id: '1', list_id: 'l', text: 'Milk', crossed_at: null, sort_order: 0 },
    { id: '2', list_id: 'l', text: 'Eggs', crossed_at: '2026-10-01T00:00:00Z', sort_order: 1 },
  ];

  it('counts what is not crossed off once the items are read', () => {
    expect(leftToGet(true, '', items)).toBe(1);
    expect(leftToGet(true, '', [])).toBe(0);
  });

  it('is nothing known before the read and when it or a write failed, never "0 to get"', () => {
    expect(leftToGet(false, '', [])).toBeNull();
    expect(leftToGet(true, 'Could not load this list. Check your connection.', [])).toBeNull();
    expect(leftToGet(true, 'Could not save. Check your connection.', items)).toBeNull();
  });
});

describe('pickedList', () => {
  const lists: SharedList[] = [
    { id: 'a', name: 'Chores', sort_order: 0 },
    { id: 'b', name: 'Groceries', sort_order: 1 },
    { id: 'c', name: 'Gifts', sort_order: 2 },
  ];

  it('is the Pinned List first, else the first list', () => {
    expect(pickedList(lists, 'b', null)).toBe('b');
    expect(pickedList(lists, null, null)).toBe('a');
    expect(pickedList(lists, 'gone', null)).toBe('a');
  });

  it('is the one chosen while it is there, and falls back when it is deleted', () => {
    expect(pickedList(lists, 'b', 'c')).toBe('c');
    expect(pickedList(lists, 'b', 'deleted')).toBe('b');
  });

  it('is nothing when there are no lists', () => {
    expect(pickedList([], null, null)).toBeNull();
  });
});

describe('a slot row', () => {
  const row = (meal: Meal | null | undefined) => renderToStaticMarkup(createElement(SlotRow, { label: 'Breakfast', slot: 'breakfast', day: thursday, meal, onOpen: noop }));
  const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');

  it('is named by its slot, day and what it holds, in words', () => {
    expect(slotRowName('Breakfast', 'Thursday 1', oatmeal)).toBe('Breakfast, Thursday 1: Oatmeal');
    expect(slotRowName('Breakfast', 'Thursday 1', null)).toBe('Breakfast, Thursday 1: nothing planned. Add a meal');
    expect(slotRowName('Breakfast', 'Thursday 1', undefined)).toBe('Breakfast, Thursday 1');
    expect(row(oatmeal)).toContain('aria-label="Breakfast, Thursday 1: Oatmeal"');
    expect(row(null)).toContain('aria-label="Breakfast, Thursday 1: nothing planned. Add a meal"');
  });

  it('is on --everyone when planned and --muted when empty, 68 px tall and a button', () => {
    const planned = classesOf(row(oatmeal));
    const empty = classesOf(row(null));
    expect(planned).toEqual(expect.arrayContaining(['bg-everyone', 'min-h-17', 'w-full']));
    expect(planned).not.toContain('bg-muted');
    expect(empty).toEqual(expect.arrayContaining(['bg-muted', 'min-h-17']));
    expect(empty).not.toContain('bg-everyone');
    expect(row(oatmeal).startsWith('<button')).toBe(true);
  });

  it('draws the slot in a 40 px disc, its name over the meal or "Add a meal" with a plus', () => {
    expect(row(oatmeal)).toContain('size-10');
    expect(row(oatmeal)).toContain('>Oatmeal<');
    expect(row(oatmeal)).not.toContain('lucide-plus');
    const empty = row(null);
    expect(empty).toContain('>Add a meal<');
    expect(empty).toContain('lucide-plus');
    expect(empty).toContain('>Breakfast<');
  });

  it('is switched off until the Meals are read, and says nothing yet', () => {
    const waiting = row(undefined);
    expect(waiting).toContain('disabled');
    expect(waiting).not.toContain('Add a meal');
  });

  it('has no em-dash', () => {
    expect(row(oatmeal) + row(null)).not.toContain('\u2014');
  });
});

describe('a list chip', () => {
  const chip = (props: Partial<Parameters<typeof ListChip>[0]> = {}) =>
    renderToStaticMarkup(createElement(ListChip, { name: 'Groceries', left: 4, pinned: false, picked: false, onPick: noop, ...props }));

  it('is named with its name and how many are left to get', () => {
    expect(listChipName('Groceries', 4)).toBe('Groceries, 4 to get');
    expect(listChipName('Groceries', 0)).toBe('Groceries, 0 to get');
    expect(listChipName('Groceries', null)).toBe('Groceries');
    expect(chip()).toContain('aria-label="Groceries, 4 to get"');
    expect(chip({ left: null })).toContain('aria-label="Groceries"');
  });

  it('presses the picked chip alone and is at least 48 tall', () => {
    expect(chip({ picked: true })).toContain('aria-pressed="true"');
    expect(chip()).toContain('aria-pressed="false"');
    expect(chip()).toContain('h-14');
    expect(chip()).toContain('min-w-12');
  });

  it('draws a pin for the Pinned List only, and the count in words under the name', () => {
    expect(chip({ pinned: true })).toContain('lucide-pin');
    expect(chip()).not.toContain('lucide-pin');
    expect(chip()).toContain('>4 to get<');
  });

  it('has no em-dash', () => {
    expect(chip({ pinned: true })).not.toContain('\u2014');
  });
});

describe('the Meals tab, drawn', () => {
  // Thursday, October 8, 2026, noon in Chicago.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T17:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  const screen = (date: string | null) =>
    renderToStaticMarkup(createElement(PhoneMeals, { route: { view: 'meals', date }, timezone: 'America/Chicago', view: { failed: false } } as unknown as PhoneScreenProps & { route: { view: 'meals'; date: string | null } }));

  it('says the week as the Calendar does, with no year in the current year and the year in another', () => {
    expect(screen(null)).toMatch(/<h2[^>]*>Oct 4 to Oct 10<\/h2>/);
    expect(screen('2026-12-27')).toMatch(/<h2[^>]*>Dec 27, 2026 to Jan 2, 2027<\/h2>/);
  });

  it("heads the picked day with the Calendar's words, in Lexend 15, weight 500, secondary", () => {
    const html = screen(null);
    const heading = /<h3 class="([^"]*)">Thursday, October 8<\/h3>/.exec(html);
    expect(heading).not.toBeNull();
    expect(heading![1]!.split(' ')).toEqual(expect.arrayContaining(['text-[15px]', 'font-medium', 'text-muted-foreground']));
    expect(heading![1]).not.toContain('font-display');
  });
});

describe('the Lists tab, drawn', () => {
  it('has an h2 of its own, before anything else, so the headings do not jump from the h1 to the picked list h3', () => {
    const html = renderToStaticMarkup(createElement(PhoneLists));
    expect(html.startsWith('<h2 class="sr-only">Lists</h2>')).toBe(true);
  });
});
