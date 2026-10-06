import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pageDays } from '../src/lib/calendar-occurrences';
import { pickedDay, slotRowName, type Meal } from '../src/lib/meals';
import { listChipName, pickedList, type SharedList } from '../src/lib/shared-lists';
import { ListChip } from '../src/phone/PhoneLists';
import { SlotRow } from '../src/phone/PhoneMeals';

// The phone's Meals and Lists tabs: the picked day and the picked list as pure rules, and a slot row and a list chip as markup. How they
// sit in a 390 px column is looked at in a browser. Colours are tokens only, so the 7:1 pairs are look.test.ts's.

const noop = () => undefined;
const LA = 'America/Los_Angeles';
const WEEK = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
const oatmeal: Meal = { id: 'm1', meal_date: '2026-10-01', slot: 'breakfast', title: 'Oatmeal' };
const thursday = pageDays('week', '2026-10-01', LA, new Date('2026-10-01T12:00:00Z'))[4]!;

describe('pickedDay', () => {
  it('is today when the week holds it', () => {
    expect(pickedDay(WEEK, new Date('2026-10-01T20:00:00Z'), LA)).toBe('2026-10-01');
  });

  it('is the Sunday when the week does not hold today', () => {
    expect(pickedDay(WEEK, new Date('2026-10-12T20:00:00Z'), LA)).toBe('2026-09-27');
    expect(pickedDay(WEEK, new Date('2026-09-20T20:00:00Z'), LA)).toBe('2026-09-27');
  });

  it("turns over at the Household's midnight, not the machine's or UTC's", () => {
    // 06:59 UTC on 4 October is 23:59 on 3 October in Los Angeles (still in the week); 07:00 UTC is midnight, the next week.
    expect(pickedDay(WEEK, new Date('2026-10-04T06:59:00Z'), LA)).toBe('2026-10-03');
    expect(pickedDay(WEEK, new Date('2026-10-04T07:00:00Z'), LA)).toBe('2026-09-27');
    // Auckland is UTC+13 in October: midnight on 4 October there is 11:00 UTC on the 3rd.
    expect(pickedDay(WEEK, new Date('2026-10-03T10:59:00Z'), 'Pacific/Auckland')).toBe('2026-10-03');
    expect(pickedDay(WEEK, new Date('2026-10-03T11:00:00Z'), 'Pacific/Auckland')).toBe('2026-09-27');
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
