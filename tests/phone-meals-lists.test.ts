import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Meal } from '../src/lib/meals';
import { leftToGet, listChipName, pickedList, type SharedList } from '../src/lib/shared-lists';
import type { ListChip as ListChipType, PhoneLists as PhoneListsType } from '../src/phone/PhoneLists';
import type { PhoneMeals as PhoneMealsType, SlotRow as SlotRowType } from '../src/phone/PhoneMeals';
import type { PhoneScreenProps } from '../src/PhoneWall';

// The phone's Meals and Lists tabs: the picked list as a pure rule, and a slot row and a list chip as markup (the picked day and what a
// slot row is called are tests/meal-plan.test.ts's). How they sit in a 390 px column is looked at in a browser. Colours are tokens
// only, so the 7:1 pairs are look.test.ts's.

// These components import the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to
// load them (as tests/phone-home.test.ts does), so CI, which has no .env.local, loads them the same way.
let ListChip: typeof ListChipType;
let PhoneLists: typeof PhoneListsType;
let PhoneMeals: typeof PhoneMealsType;
let SlotRow: typeof SlotRowType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ ListChip, PhoneLists } = await import('../src/phone/PhoneLists'));
  ({ PhoneMeals, SlotRow } = await import('../src/phone/PhoneMeals'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const noop = () => undefined;
const oatmeal: Meal = { id: 'm1', meal_date: '2026-10-01', slot: 'breakfast', title: 'Oatmeal' };

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
  // Named as the plan names it (cellFor's `heard`), which tests/meal-plan.test.ts holds to the words.
  const heard = (meal: Meal | null | undefined) => (meal === undefined ? 'Breakfast, Thursday 1' : `Breakfast, Thursday 1: ${meal ? meal.title : 'nothing planned. Add a meal'}`);
  const row = (meal: Meal | null | undefined) => renderToStaticMarkup(createElement(SlotRow, { label: 'Breakfast', slot: 'breakfast', meal, heard: heard(meal), onOpen: noop }));
  const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');

  it('is named by what it is given to be heard as', () => {
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
