import { describe, expect, it } from 'vitest';
import type { Profile } from '../src/lib/profiles';
import type { Routine } from '../src/lib/routines';
import { keepIfSame, sameData } from '../src/lib/same-data';

// A screen that reads on a timer (the Household every 30 seconds, today's Routines every 30 seconds) keeps the object it has when a
// read finds nothing new, so the whole Wall under it is not drawn again for nothing: a new object is a new render of everything
// below it. What "nothing new" means is pure, so it is tested here and not through a screen.

describe('whether two reads hold the same data', () => {
  it('is yes for the same value, and for plain values that are equal', () => {
    for (const value of ['a', '', 0, 1.5, true, false, null, undefined]) expect(sameData(value, value), String(value)).toBe(true);
    expect(sameData(NaN, NaN)).toBe(true);
  });

  it('is no for plain values that differ, whatever they are (no coercion)', () => {
    for (const [a, b] of [['1', 1], [0, false], [null, undefined], ['', null], [0, -0 + 1]] as const) expect(sameData(a, b), `${String(a)} and ${String(b)}`).toBe(false);
  });

  it('is yes for objects with the same fields, in any order, however deep', () => {
    expect(sameData({ a: 1, b: { c: ['x', { d: null }] } }, { b: { c: ['x', { d: null }] }, a: 1 })).toBe(true);
  });

  it('is no when a field differs, however deep, or one has a field the other has not', () => {
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameData({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('is yes for lists of the same items in the same order, and no for the same items in another order, or more or fewer', () => {
    expect(sameData([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])).toBe(true);
    expect(sameData([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }])).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData([], [])).toBe(true);
    // A list is not an object with the same keys.
    expect(sameData([], {})).toBe(false);
    expect(sameData({ 0: 'a' }, ['a'])).toBe(false);
  });

  it('is yes for Sets with the same members, in any order, and no otherwise', () => {
    expect(sameData(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameData(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameData(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false);
    expect(sameData(new Set(), new Set())).toBe(true);
    expect(sameData(new Set(), [])).toBe(false);
    expect(sameData(new Set(), {})).toBe(false);
  });

  it('is no for anything that is not plain data and is not the very same value: it is never wrongly the same', () => {
    expect(sameData(new Date(1), new Date(2))).toBe(false);
    expect(sameData(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(false);
    const date = new Date(1);
    expect(sameData(date, date)).toBe(true);
    class Box {
      constructor(readonly value: number) {}
    }
    expect(sameData(new Box(1), new Box(1))).toBe(false);
  });
});

describe('the object a screen keeps', () => {
  it('is the one it has when the read is the same data, and the read when it is not', () => {
    const held = { name: 'Home', timezone: 'America/Chicago' };
    expect(keepIfSame(held, { name: 'Home', timezone: 'America/Chicago' })).toBe(held);
    const read = { name: 'Home', timezone: 'Europe/London' };
    expect(keepIfSame(held, read)).toBe(read);
  });

  it('is the read when it has nothing yet', () => {
    const read = { a: 1 };
    expect(keepIfSame(null, read)).toBe(read);
  });

  describe("for a read of today's Routines", () => {
    const profile = (id: string, name: string, sort: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: sort });
    const routine = (id: string, title: string): Routine => ({ id, profile_id: 'p-ava', title, days_of_week: 127, time_of_day: 'evening', picture: null, sort_order: 0, archived_at: null });
    const today = () => ({
      date: '2026-10-01',
      profiles: [profile('p-ava', 'Ava', 0), profile('p-ben', 'Ben', 1)],
      routines: [routine('r-1', 'Brush teeth'), routine('r-2', 'Tidy toys')],
      done: new Set(['r-1']),
    });

    it('keeps what the screen has when nothing in the read changed, however often it is read', () => {
      const held = today();
      for (let read = 0; read < 5; read += 1) expect(keepIfSame(held, today())).toBe(held);
    });

    it('takes the read when anything in it changed: the day, a Profile, a Routine, a tick', () => {
      const held = today();
      const changed = [
        { ...today(), date: '2026-10-02' },
        { ...today(), profiles: [profile('p-ava', 'Ava B', 0), profile('p-ben', 'Ben', 1)] },
        { ...today(), profiles: [profile('p-ava', 'Ava', 0)] },
        { ...today(), routines: [routine('r-1', 'Brush your teeth'), routine('r-2', 'Tidy toys')] },
        { ...today(), routines: [routine('r-1', 'Brush teeth')] },
        { ...today(), routines: [{ ...routine('r-1', 'Brush teeth'), time_of_day: 'morning' as const }, routine('r-2', 'Tidy toys')] },
        { ...today(), routines: [{ ...routine('r-1', 'Brush teeth'), picture: 'teeth' }, routine('r-2', 'Tidy toys')] },
        { ...today(), done: new Set(['r-1', 'r-2']) },
        { ...today(), done: new Set<string>() },
        { ...today(), done: new Set(['r-2']) },
      ];
      for (const [index, read] of changed.entries()) expect(keepIfSame(held, read), `change ${index}`).toBe(read);
    });
  });
});
