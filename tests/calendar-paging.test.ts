import { describe, expect, it } from 'vitest';
import {
  addMonths,
  clampToWindow,
  pageDays,
  pageStart,
  paging,
  pagingWindow,
  weekStart,
} from '../src/lib/calendar-occurrences';

const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';
const SANTIAGO = 'America/Santiago';

describe('weekStart', () => {
  it('is the Sunday on or before the date', () => {
    expect(weekStart('2026-09-27')).toBe('2026-09-27'); // Sunday
    expect(weekStart('2026-09-30')).toBe('2026-09-27'); // Wednesday
    expect(weekStart('2026-10-03')).toBe('2026-09-27'); // Saturday
    expect(weekStart('2026-10-04')).toBe('2026-10-04');
  });

  it('crosses a month and a year', () => {
    expect(weekStart('2026-03-01')).toBe('2026-03-01');
    expect(weekStart('2026-01-01')).toBe('2025-12-28');
  });
});

describe('addMonths', () => {
  it('stops at the end of a shorter month', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('keeps the day otherwise, across a year', () => {
    expect(addMonths('2026-09-30', 6)).toBe('2027-03-30');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('pagingWindow', () => {
  it('runs from a month before today to six months after, as Household dates', () => {
    expect(pagingWindow(CHICAGO, new Date('2026-09-30T15:00:00Z'))).toEqual({ first: '2026-08-30', last: '2027-03-30' });
  });

  it('takes today in the Household Timezone, not the machine zone', () => {
    // 2026-09-30 16:00Z is already Oct 1 in Tokyo and still Sep 30 in Chicago.
    const now = new Date('2026-09-30T16:00:00Z');
    expect(pagingWindow(TOKYO, now).first).toBe('2026-09-01');
    expect(pagingWindow(CHICAGO, now).first).toBe('2026-08-30');
  });
});

describe('pageStart and pageDays', () => {
  const now = new Date('2026-09-30T15:00:00Z');

  it('a week page starts on the Sunday and has seven days', () => {
    expect(pageStart('week', '2026-09-30')).toBe('2026-09-27');
    const days = pageDays('week', '2026-09-27', CHICAGO, now);
    expect(days.map((day) => day.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(days.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-09-30']);
  });

  it('a day page is one day, today or not', () => {
    expect(pageStart('day', '2026-10-02')).toBe('2026-10-02');
    expect(pageDays('day', '2026-10-02', CHICAGO, now).map((day) => [day.date, day.isToday])).toEqual([['2026-10-02', false]]);
    expect(pageDays('day', '2026-09-30', CHICAGO, now)[0]!.isToday).toBe(true);
  });

  it('marks today by the Household Timezone', () => {
    const late = new Date('2026-09-30T16:00:00Z'); // Oct 1 in Tokyo
    expect(pageDays('day', '2026-10-01', TOKYO, late)[0]!.isToday).toBe(true);
  });

  it('a week over a DST change has day lengths that follow the wall clock', () => {
    // US clocks go back Sunday 2026-11-01: the first day of that week is 25 hours long.
    const days = pageDays('week', '2026-11-01', CHICAGO, now);
    expect((days[0]!.endMs - days[0]!.startMs) / 3_600_000).toBe(25);
    expect((days[1]!.endMs - days[1]!.startMs) / 3_600_000).toBe(24);
  });

  it('a day that skips its midnight still starts on its own date (Santiago)', () => {
    const days = pageDays('day', '2026-09-06', SANTIAGO, now);
    expect(days[0]!.date).toBe('2026-09-06');
    expect((days[0]!.endMs - days[0]!.startMs) / 3_600_000).toBe(23);
  });
});

describe('paging', () => {
  const window = { first: '2026-08-30', last: '2027-03-30' };

  it('pages a week by seven days and a day by one', () => {
    expect(paging('week', '2026-09-27', window)).toEqual({ previous: '2026-09-20', next: '2026-10-04' });
    expect(paging('day', '2026-09-30', window)).toEqual({ previous: '2026-09-29', next: '2026-10-01' });
  });

  it('stops going back once the previous page is wholly before the window', () => {
    // The week of Aug 23 to 29 is wholly outside; the week of Aug 30 (a Sunday) is the first allowed.
    expect(paging('week', '2026-08-30', window).previous).toBeNull();
    expect(paging('week', '2026-09-06', window).previous).toBe('2026-08-30');
    expect(paging('day', '2026-08-30', window).previous).toBeNull();
    expect(paging('day', '2026-08-31', window).previous).toBe('2026-08-30');
  });

  it('keeps a week that only partly falls in the window', () => {
    // A window that starts midweek: the week of Aug 30 holds its first days, so it can be paged to.
    const midweek = { first: '2026-09-02', last: '2027-03-30' };
    expect(paging('week', '2026-09-06', midweek).previous).toBe('2026-08-30');
    expect(paging('week', '2026-08-30', midweek).previous).toBeNull();
  });

  it('stops going forward once the next page starts after the window', () => {
    expect(paging('day', '2027-03-30', window).next).toBeNull();
    expect(paging('day', '2027-03-29', window).next).toBe('2027-03-30');
    // The week of Mar 28 holds Mar 30, the last day: it is the last week.
    expect(paging('week', '2027-03-28', window).next).toBeNull();
    expect(paging('week', '2027-03-21', window).next).toBe('2027-03-28');
  });
});

describe('clampToWindow', () => {
  const window = { first: '2026-08-30', last: '2027-03-30' };

  it('leaves a date inside the window alone and pulls others to the nearest end', () => {
    expect(clampToWindow('2026-10-01', window)).toBe('2026-10-01');
    expect(clampToWindow('2020-01-01', window)).toBe('2026-08-30');
    expect(clampToWindow('2030-01-01', window)).toBe('2027-03-30');
  });
});
