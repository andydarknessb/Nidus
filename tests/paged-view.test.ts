import { describe, expect, it } from 'vitest';
import {
  addMonths,
  CALENDAR_LIMITS,
  canOpenDay,
  clampToWindow,
  createPageFocus,
  limitWords,
  MEAL_PLAN_LIMITS,
  monthWeeks,
  pagedView,
  pageDays,
  pageStart,
  paging,
  pagingWindow,
  pagingWindowAround,
  shownDate,
  weekStart,
  type WallDay,
} from '../src/lib/paged-view';
import { dayStartMs, householdDay } from '../supabase/functions/_shared/zoned-time.ts';

const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';
const SANTIAGO = 'America/Santiago';
const LONDON = 'Europe/London';
const KOLKATA = 'Asia/Kolkata';

// Thu Oct 1, 2026, 10:00 in Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-01T15:00:00Z');
const TODAY = '2026-10-01';

const dates = (week: WallDay[]) => week.map((day) => day.date);
const hours = (day: WallDay) => (day.endMs - day.startMs) / 3_600_000;


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

  it('is the window around a Household date, once today is already known', () => {
    expect(pagingWindowAround('2026-09-30')).toEqual({ first: '2026-08-30', last: '2027-03-30' });
    expect(pagingWindowAround('2026-10-01')).toEqual({ first: '2026-09-01', last: '2027-04-01' });
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

  it('a month page starts on the 1st, whichever date of the month names it', () => {
    expect(pageStart('month', '2026-10-01')).toBe('2026-10-01');
    expect(pageStart('month', '2026-10-17')).toBe('2026-10-01');
    expect(pageStart('month', '2026-10-31')).toBe('2026-10-01');
    expect(pageStart('month', '2026-12-31')).toBe('2026-12-01');
    expect(pageStart('month', '2028-02-29')).toBe('2028-02-01');
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

  it('pages a month by one month, from whichever date of it names it', () => {
    expect(paging('month', '2026-10-01', window)).toEqual({ previous: '2026-09-01', next: '2026-11-01' });
    expect(paging('month', '2026-10-17', window)).toEqual({ previous: '2026-09-01', next: '2026-11-01' });
    expect(paging('month', '2026-12-01', window).next).toBe('2027-01-01');
    expect(paging('month', '2027-01-01', window).previous).toBe('2026-12-01');
  });

  it('stops going back once the previous month is wholly before the window', () => {
    // The window starts on Aug 30, so August holds its last two days and can be paged to; July cannot.
    expect(paging('month', '2026-09-01', window).previous).toBe('2026-08-01');
    expect(paging('month', '2026-08-01', window).previous).toBeNull();
    expect(paging('month', '2026-08-17', window).previous).toBeNull();
    // Its last day alone is enough, and a window that starts the day after is not.
    expect(paging('month', '2026-09-01', { first: '2026-08-31', last: '2027-03-30' }).previous).toBe('2026-08-01');
    expect(paging('month', '2026-09-01', { first: '2026-09-01', last: '2027-03-30' }).previous).toBeNull();
  });

  it('stops going forward once the next month starts after the window', () => {
    // The window ends on Mar 30, so March holds it and is the last month.
    expect(paging('month', '2027-02-01', window).next).toBe('2027-03-01');
    expect(paging('month', '2027-03-01', window).next).toBeNull();
    // A window that ends on the 1st of a month holds that month, but not the one after.
    const toFirst = { first: '2026-09-01', last: '2027-04-01' };
    expect(paging('month', '2027-03-01', toFirst).next).toBe('2027-04-01');
    expect(paging('month', '2027-04-01', toFirst).next).toBeNull();
  });

  it('pages months from September to April when today is Oct 1', () => {
    const real = pagingWindow(CHICAGO, new Date('2026-10-01T15:00:00Z'));
    expect(paging('month', '2026-09-01', real)).toEqual({ previous: null, next: '2026-10-01' });
    expect(paging('month', '2027-04-01', real)).toEqual({ previous: '2027-03-01', next: null });
  });
});

describe('shownDate', () => {
  it('is today when the address has no date, and the address\'s date inside the window', () => {
    expect(shownDate(null, TODAY)).toBe('2026-10-01');
    expect(shownDate('2026-10-11', TODAY)).toBe('2026-10-11');
    expect(shownDate('2026-09-01', TODAY)).toBe('2026-09-01');
    expect(shownDate('2027-04-01', TODAY)).toBe('2027-04-01');
  });

  it('is the nearest end of the window for an address outside it', () => {
    expect(shownDate('2020-01-01', TODAY)).toBe('2026-09-01');
    expect(shownDate('2026-08-30', TODAY)).toBe('2026-09-01');
    expect(shownDate('2027-04-02', TODAY)).toBe('2027-04-01');
    expect(shownDate('2030-01-01', TODAY)).toBe('2027-04-01');
  });
});

describe('canOpenDay', () => {
  const window = pagingWindowAround(TODAY);

  it('is true for a day inside the window, both ends included', () => {
    expect(canOpenDay('2026-09-01', window)).toBe(true);
    expect(canOpenDay('2026-10-01', window)).toBe(true);
    expect(canOpenDay('2027-04-01', window)).toBe(true);
  });

  it('is false for a day outside it, which would open its nearest end instead', () => {
    // The week of Aug 30 shows two days before the window and the week of Mar 28 two after it.
    expect(canOpenDay('2026-08-30', window)).toBe(false);
    expect(canOpenDay('2026-08-31', window)).toBe(false);
    expect(canOpenDay('2027-04-02', window)).toBe(false);
    expect(canOpenDay('2027-04-03', window)).toBe(false);
    expect(canOpenDay('2020-01-01', window)).toBe(false);
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

describe('the month grid', () => {
  it('is whole Sunday-to-Saturday weeks from the 1st to the last day', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthWeeks('2026-10-01', CHICAGO, TODAY);
    expect(weeks.map(dates)).toEqual([
      ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
      ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
      ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
      ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'],
      ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'],
    ]);
    for (const week of weeks) expect(week.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('is the same grid whichever date of the month names it', () => {
    const first = monthWeeks('2026-10-01', CHICAGO, TODAY).map(dates);
    expect(monthWeeks('2026-10-17', CHICAGO, TODAY).map(dates)).toEqual(first);
    expect(monthWeeks('2026-10-31', CHICAGO, TODAY).map(dates)).toEqual(first);
  });

  it('starts on the 1st itself when the month starts on a Sunday', () => {
    // March 2026 starts on Sunday the 1st, so no day of February is shown.
    const weeks = monthWeeks('2026-03-01', CHICAGO, TODAY);
    expect(weeks[0]![0]!.date).toBe('2026-03-01');
    expect(weeks).toHaveLength(5);
    // It ends on a Tuesday, so the last week runs on into April.
    expect(dates(weeks[4]!)).toEqual(['2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04']);
  });

  it('ends on the last day itself when the month ends on a Saturday', () => {
    // October 2026 ends on Saturday the 31st, so no day of November is shown and there is no sixth row.
    const weeks = monthWeeks('2026-10-01', CHICAGO, TODAY);
    expect(weeks).toHaveLength(5);
    const last = weeks[4]!;
    expect(last[0]!.date).toBe('2026-10-25');
    expect(last[6]!.date).toBe('2026-10-31');
  });

  it('is four rows when a 28 day month starts on a Sunday', () => {
    // February 2026: Sunday the 1st to Saturday the 28th, and not a day of January or March.
    const weeks = monthWeeks('2026-02-01', CHICAGO, TODAY);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]![0]!.date).toBe('2026-02-01');
    expect(weeks[3]![6]!.date).toBe('2026-02-28');
  });

  it('is six rows when the month runs late into its last week', () => {
    // January 2027 starts on a Friday and ends on a Sunday: the 31st has a row to itself.
    const weeks = monthWeeks('2027-01-01', CHICAGO, TODAY);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]!.date).toBe('2026-12-27');
    expect(dates(weeks[5]!)).toEqual(['2027-01-31', '2027-02-01', '2027-02-02', '2027-02-03', '2027-02-04', '2027-02-05', '2027-02-06']);
  });

  it('counts the rows of every shape of month', () => {
    const rows = (date: string) => monthWeeks(date, CHICAGO, TODAY).length;
    expect(rows('2026-02-01')).toBe(4); // 28 days from a Sunday
    expect(rows('2026-03-01')).toBe(5); // 31 days from a Sunday
    expect(rows('2026-10-01')).toBe(5); // 31 days from a Thursday
    expect(rows('2028-02-01')).toBe(5); // a leap February, 29 days from a Tuesday
    expect(rows('2025-11-01')).toBe(6); // 30 days from a Saturday
    expect(rows('2026-08-01')).toBe(6); // 31 days from a Saturday
    expect(rows('2027-01-01')).toBe(6); // 31 days from a Friday
  });

  it('shows the 29th of a leap February', () => {
    const grid = monthWeeks('2028-02-01', CHICAGO, TODAY).flat();
    expect(grid.map((day) => day.date)).toContain('2028-02-29');
    expect(grid[0]!.date).toBe('2028-01-30');
    expect(grid[grid.length - 1]!.date).toBe('2028-03-04');
  });

  it('starts each day at Household midnight, not UTC midnight', () => {
    // Chicago is on CST (UTC-6) on 2026-03-01.
    expect(monthWeeks('2026-03-01', CHICAGO, TODAY)[0]![0]!.startMs).toBe(Date.parse('2026-03-01T06:00:00Z'));
  });

  it('has a 23 hour day when clocks go forward, and every day ends where the next begins', () => {
    // US clocks go forward on Sunday 2026-03-08: 2:00 AM becomes 3:00 AM.
    const grid = monthWeeks('2026-03-01', CHICAGO, TODAY).flat();
    expect(hours(grid.find((day) => day.date === '2026-03-08')!)).toBe(23);
    expect(grid.filter((day) => hours(day) !== 24).map((day) => day.date)).toEqual(['2026-03-08']);
    grid.slice(0, -1).forEach((day, index) => expect(day.endMs).toBe(grid[index + 1]!.startMs));
  });

  it('has a 25 hour day when clocks go back, and every day ends where the next begins', () => {
    // US clocks go back on Sunday 2026-11-01: 2:00 AM becomes 1:00 AM, and the month starts on that day.
    const grid = monthWeeks('2026-11-01', CHICAGO, TODAY).flat();
    expect(grid[0]!.date).toBe('2026-11-01');
    expect(hours(grid[0]!)).toBe(25);
    expect(grid.filter((day) => hours(day) !== 24).map((day) => day.date)).toEqual(['2026-11-01']);
    grid.slice(0, -1).forEach((day, index) => expect(day.endMs).toBe(grid[index + 1]!.startMs));
  });

  it('marks today, also where it is a day of the neighbouring month', () => {
    const today = (month: string) => monthWeeks(month, CHICAGO, TODAY).flat().filter((day) => day.isToday).map((day) => day.date);
    expect(today('2026-10-01')).toEqual(['2026-10-01']);
    // The grid for September runs on to Saturday Oct 3.
    expect(today('2026-09-01')).toEqual(['2026-10-01']);
    expect(today('2026-11-01')).toEqual([]);
  });

  it('marks the date it is given, and only that one', () => {
    const marked = (today: string) => monthWeeks('2026-10-01', CHICAGO, today).flat().filter((day) => day.isToday).map((day) => day.date);
    expect(marked('2026-10-15')).toEqual(['2026-10-15']);
    expect(marked('2026-09-30')).toEqual(['2026-09-30']);
    expect(marked('2026-12-25')).toEqual([]);
  });

  it('puts the days in the Household Timezone, not the machine zone', () => {
    // Tokyo is UTC+9: its Thursday Oct 1 begins at 15:00Z on Sep 30, and Chicago's at 05:00Z on Oct 1.
    const thursday = (timezone: string) => monthWeeks('2026-10-01', timezone, TODAY)[0]![4]!;
    expect(thursday(TOKYO).date).toBe('2026-10-01');
    expect(thursday(TOKYO).startMs).toBe(Date.parse('2026-09-30T15:00:00Z'));
    expect(thursday(CHICAGO).startMs).toBe(Date.parse('2026-10-01T05:00:00Z'));
  });
});

describe('the month grid in other zones', () => {
  // A day is the run of instants from its own midnight to the next one's, whatever the zone does to its clocks.
  const grid = (month: string, timezone: string) => monthWeeks(month, timezone, TODAY).flat();
  const odd = (days: WallDay[]) => days.filter((day) => hours(day) !== 24).map((day) => [day.date, hours(day)]);
  const continuous = (days: WallDay[]) => days.slice(0, -1).every((day, index) => day.endMs === days[index + 1]!.startMs);
  const sundayFirst = (month: string, timezone: string) => monthWeeks(month, timezone, TODAY).every((week) => week.map((day) => day.weekday).join() === '0,1,2,3,4,5,6');
  const startOf = (days: WallDay[], date: string) => days.find((day) => day.date === date)!.startMs;

  it('has a day that starts at 01:00, 23 hours long, where Santiago skips its midnight', () => {
    // On Sunday 2026-09-06 Santiago's clocks go from Saturday 23:59 (-04) straight to Sunday 01:00 (-03): that
    // Sunday has no midnight, so it begins at the first instant that is on it.
    const days = grid('2026-09-01', SANTIAGO);
    expect(startOf(days, '2026-09-06')).toBe(Date.parse('2026-09-06T04:00:00Z'));
    expect(days.find((day) => day.date === '2026-09-06')!.endMs).toBe(Date.parse('2026-09-07T03:00:00Z'));
    // The Saturday before has its own midnight (-04) and is a whole 24 hours, ending where the skipped day begins.
    expect(startOf(days, '2026-09-05')).toBe(Date.parse('2026-09-05T04:00:00Z'));
    expect(odd(days)).toEqual([['2026-09-06', 23]]);
    expect(continuous(days)).toBe(true);
    expect(sundayFirst('2026-09-01', SANTIAGO)).toBe(true);
  });

  it('has a 25 hour Saturday where Santiago turns its clocks back', () => {
    // On Saturday 2026-04-04 the clocks go from 23:59 (-03) back to 23:00 (-04): the day's last hour happens twice.
    const days = grid('2026-04-01', SANTIAGO);
    expect(odd(days)).toEqual([['2026-04-04', 25]]);
    expect(startOf(days, '2026-04-05')).toBe(Date.parse('2026-04-05T04:00:00Z'));
    expect(continuous(days)).toBe(true);
    expect(sundayFirst('2026-04-01', SANTIAGO)).toBe(true);
  });

  it('has a 23 hour Sunday where London goes forward and a 25 hour one where it goes back', () => {
    // 2026-03-29: 01:00 GMT becomes 02:00 BST. 2026-10-25: 02:00 BST becomes 01:00 GMT. Either way the Sunday
    // begins at its own midnight, which in summer is 23:00 UTC the evening before.
    const spring = grid('2026-03-01', LONDON);
    expect(odd(spring)).toEqual([['2026-03-29', 23]]);
    expect(startOf(spring, '2026-03-29')).toBe(Date.parse('2026-03-29T00:00:00Z'));
    expect(startOf(spring, '2026-03-30')).toBe(Date.parse('2026-03-29T23:00:00Z'));
    const autumn = grid('2026-10-01', LONDON);
    expect(odd(autumn)).toEqual([['2026-10-25', 25]]);
    expect(startOf(autumn, '2026-10-25')).toBe(Date.parse('2026-10-24T23:00:00Z'));
    expect(startOf(autumn, '2026-10-26')).toBe(Date.parse('2026-10-26T00:00:00Z'));
    expect(continuous(spring) && continuous(autumn)).toBe(true);
    // The weekdays are the zone's, not UTC's, which put every summer midnight on the day before.
    expect(sundayFirst('2026-03-01', LONDON) && sundayFirst('2026-10-01', LONDON)).toBe(true);
  });

  it('keeps every day of every month of the window between its own two midnights, in any zone', () => {
    const months = ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01'];
    for (const timezone of [CHICAGO, TOKYO, SANTIAGO, LONDON, KOLKATA]) {
      for (const month of months) {
        const weeks = monthWeeks(month, timezone, TODAY);
        const days = weeks.flat();
        const where = `${timezone} ${month}`;
        expect(weeks.length, where).toBeGreaterThanOrEqual(4);
        expect(weeks.length, where).toBeLessThanOrEqual(6);
        expect(days.length, where).toBe(weeks.length * 7);
        expect(sundayFirst(month, timezone), where).toBe(true);
        expect(continuous(days), where).toBe(true);
        for (const day of days) {
          expect([23, 24, 25], `${where} ${day.date}`).toContain(hours(day));
          // The first instant and the last one of the day are both on the day's own date.
          expect(householdDay(timezone, new Date(day.startMs)).date, `${where} ${day.date} start`).toBe(day.date);
          expect(householdDay(timezone, new Date(day.endMs - 1)).date, `${where} ${day.date} end`).toBe(day.date);
        }
      }
    }
  });
});


// A day of the grid that canOpenDay refuses (its own tests are above) is beyond the window.
describe('days beyond the window', () => {
  const window = pagingWindow(CHICAGO, NOW);
  const beyond = (month: string, within = window) => monthWeeks(month, CHICAGO, TODAY).flat().filter((day) => !canOpenDay(day.date, within)).map((day) => day.date);

  it('are none in a month wholly inside it', () => {
    expect(window).toEqual({ first: '2026-09-01', last: '2027-04-01' });
    expect(beyond('2026-10-01')).toEqual([]);
  });

  it('are the days before the first date in the first month', () => {
    // The grid for September starts on Sunday Aug 30.
    expect(beyond('2026-09-01')).toEqual(['2026-08-30', '2026-08-31']);
  });

  it('are the days after the last date in the last month', () => {
    // The grid for April starts on Sunday Mar 28 and ends on Saturday May 1; only Apr 1 is inside.
    const days = beyond('2027-04-01');
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2027-04-02');
    expect(days[days.length - 1]).toBe('2027-05-01');
  });

  it('are the part of the first month before a window that starts mid-month', () => {
    const midMonth = pagingWindow(CHICAGO, new Date('2026-10-15T15:00:00Z'));
    expect(midMonth.first).toBe('2026-09-15');
    const days = beyond('2026-09-01', midMonth);
    // Aug 30 and 31, then Sep 1 to 14.
    expect(days).toHaveLength(16);
    expect(days[0]).toBe('2026-08-30');
    expect(days[days.length - 1]).toBe('2026-09-14');
  });
});

describe('pagedView', () => {
  it('answers a week: today, its anchor, its seven days and the pages either side', () => {
    const page = pagedView('week', '2026-09-30', NOW, CHICAGO);
    expect(page.today).toBe('2026-10-01');
    expect(page.anchor).toBe('2026-09-27');
    expect(page.days?.map((day) => day.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(page.days?.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-10-01']);
    expect(page.previous).toBe('2026-09-20');
    expect(page.next).toBe('2026-10-04');
    expect(page.window).toEqual({ first: '2026-09-01', last: '2027-04-01' });
  });

  it('answers a day and a month, a month being a grid of weeks drawn from its anchor and so having no days here', () => {
    const day = pagedView('day', '2026-10-14', NOW, CHICAGO);
    expect(day.days?.map((each) => each.date)).toEqual(['2026-10-14']);
    expect([day.previous, day.next]).toEqual(['2026-10-13', '2026-10-15']);
    const month = pagedView('month', '2026-10-17', NOW, CHICAGO);
    expect(month.anchor).toBe('2026-10-01');
    expect(month.days).toBeNull();
    expect([month.previous, month.next]).toEqual(['2026-09-01', '2026-11-01']);
  });

  it('is on today\'s page when no date is asked for', () => {
    expect(pagedView('week', null, NOW, CHICAGO).anchor).toBe('2026-09-27');
    expect(pagedView('day', null, NOW, CHICAGO).anchor).toBe('2026-10-01');
    expect(pagedView('month', null, NOW, CHICAGO).anchor).toBe('2026-10-01');
  });

  it('has no previous page on the first page of the window, and no next page on the last', () => {
    // The window runs from Sep 1, 2026 to Apr 1, 2027. The week of Aug 30 holds its first day; the week of Mar 28 holds its last.
    const first = pagedView('week', '2026-09-01', NOW, CHICAGO);
    expect([first.anchor, first.previous, first.next]).toEqual(['2026-08-30', null, '2026-09-06']);
    const last = pagedView('week', '2027-04-01', NOW, CHICAGO);
    expect([last.anchor, last.previous, last.next]).toEqual(['2027-03-28', '2027-03-21', null]);
    expect(pagedView('day', '2026-09-01', NOW, CHICAGO).previous).toBeNull();
    expect(pagedView('day', '2027-04-01', NOW, CHICAGO).next).toBeNull();
    expect(pagedView('month', '2026-10-01', NOW, CHICAGO).previous).toBe('2026-09-01');
    expect(pagedView('month', '2026-09-01', NOW, CHICAGO).previous).toBeNull();
    expect(pagedView('month', '2027-04-01', NOW, CHICAGO).next).toBeNull();
  });

  it('shows the page at the end of the window for a date outside it', () => {
    const before = pagedView('day', '2020-01-01', NOW, CHICAGO);
    expect([before.anchor, before.previous]).toEqual(['2026-09-01', null]);
    const after = pagedView('week', '2030-01-01', NOW, CHICAGO);
    expect([after.anchor, after.next]).toEqual(['2027-03-28', null]);
  });

  it('takes today in the Household Timezone, not the machine zone', () => {
    // 2026-09-30 16:00Z is already Oct 1 in Tokyo and still Sep 30 in Chicago.
    const late = new Date('2026-09-30T16:00:00Z');
    expect(pagedView('day', null, late, TOKYO).anchor).toBe('2026-10-01');
    expect(pagedView('day', null, late, CHICAGO).anchor).toBe('2026-09-30');
    expect(pagedView('day', null, late, TOKYO).days?.[0]?.isToday).toBe(true);
  });

  it('moves on at Household midnight: the week turns at Saturday night, and the window with it', () => {
    const beforeMidnight = new Date('2026-10-04T04:59:00Z'); // Sat Oct 3, 23:59 in Chicago
    const afterMidnight = new Date('2026-10-04T05:00:00Z'); // Sun Oct 4, 00:00
    const before = pagedView('week', null, beforeMidnight, CHICAGO);
    const after = pagedView('week', null, afterMidnight, CHICAGO);
    expect([before.today, before.anchor]).toEqual(['2026-10-03', '2026-09-27']);
    expect([after.today, after.anchor]).toEqual(['2026-10-04', '2026-10-04']);
    expect(after.window).toEqual({ first: '2026-09-04', last: '2027-04-04' });
  });

  it('is the same page from the start of today as from any instant of it, which is how the Meals screen asks', () => {
    const startOfToday = new Date(dayStartMs('2026-10-01', CHICAGO));
    for (const view of ['day', 'week', 'month'] as const) {
      expect(pagedView(view, '2026-10-14', startOfToday, CHICAGO)).toEqual(pagedView(view, '2026-10-14', NOW, CHICAGO));
    }
  });
});

describe('limitWords', () => {
  const words = { back: 'This is as far back as it goes.', ahead: 'This is as far ahead as it goes.' };

  it('says nothing between the limits', () => {
    expect(limitWords(pagedView('week', null, NOW, CHICAGO), words)).toBe('');
  });

  it('says it when there is no page before, and when there is none after', () => {
    expect(limitWords(pagedView('week', '2026-09-01', NOW, CHICAGO), words)).toBe(words.back);
    expect(limitWords(pagedView('week', '2027-04-01', NOW, CHICAGO), words)).toBe(words.ahead);
  });

  it('says how far back when both ends are in reach', () => {
    expect(limitWords({ previous: null, next: null }, words)).toBe(words.back);
  });

  it('is each screen\'s own sentence: the calendar keeps one month back and six ahead, the meal plan only says where it ends', () => {
    expect(CALENDAR_LIMITS.back).toBe('This is as far back as the calendar goes. It keeps one month of past events.');
    expect(CALENDAR_LIMITS.ahead).toBe('This is as far ahead as the calendar goes. It keeps six months of upcoming events.');
    expect(MEAL_PLAN_LIMITS.back).toBe('This is as far back as the meal plan goes.');
    expect(MEAL_PLAN_LIMITS.ahead).toBe('This is as far ahead as the meal plan goes.');
  });
});

// Where focus goes. The core is told what the person has open (the view and the date they asked for), where the page is anchored, and
// whether focus was lost; it says the title or nowhere. The hook only performs it.
describe('where focus goes', () => {
  const week = { view: 'week', date: '2026-09-27', anchor: '2026-09-27' } as const;
  const nextWeek = { view: 'week', date: '2026-10-04', anchor: '2026-10-04' } as const;

  describe('on the Wall, which takes focus on arrival', () => {
    it('puts it on the title when the screen opens, wherever focus was', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      expect(focus.after(week, false)).toBe('title');
    });

    it('puts it on the title when another view opens, wherever focus was (the navigation rail, or a day opened from the week)', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      focus.after(week, false);
      expect(focus.after({ view: 'day', date: '2026-10-01', anchor: '2026-10-01' }, false)).toBe('title');
    });

    it('does not take it a second time when the same page is drawn again (StrictMode runs an effect twice)', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      focus.after(week, false);
      expect(focus.after(week, false)).toBe('nowhere');
    });

    it('puts it on the title after a page turn when focus was lost with the page', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      focus.after(week, false);
      expect(focus.after(nextWeek, true)).toBe('title');
    });

    it('leaves it alone after a page turn when focus was elsewhere (a keyboard on the button, a Profile\'s chip)', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      focus.after(week, false);
      expect(focus.after(nextWeek, false)).toBe('nowhere');
    });

    it('turns the same view\'s pages one after another by the same rule', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      focus.after(week, false);
      expect(focus.after(nextWeek, false)).toBe('nowhere');
      expect(focus.after(week, true)).toBe('title');
      expect(focus.after(nextWeek, false)).toBe('nowhere');
    });
  });

  describe('at Household midnight, when the page moves by itself', () => {
    // The person asked for no date, so the page follows today: the view and the date are the same, and only the anchor moves.
    const thisWeek = { view: 'week', date: null, anchor: '2026-09-27' } as const;
    const nextWeekByItself = { view: 'week', date: null, anchor: '2026-10-04' } as const;

    it('puts it on the title when the page it was in has gone', () => {
      for (const takesFocusOnArrival of [true, false]) {
        const focus = createPageFocus({ takesFocusOnArrival });
        focus.after(thisWeek, false);
        expect(focus.after(nextWeekByItself, true), `takes on arrival: ${takesFocusOnArrival}`).toBe('title');
      }
    });

    it('leaves it alone when focus was elsewhere, even on a screen that takes focus when it opens', () => {
      for (const takesFocusOnArrival of [true, false]) {
        const focus = createPageFocus({ takesFocusOnArrival });
        focus.after(thisWeek, false);
        expect(focus.after(nextWeekByItself, false), `takes on arrival: ${takesFocusOnArrival}`).toBe('nowhere');
      }
    });

    it('is not an arrival: the view did not change, so a Wall that takes focus on arrival does not take it', () => {
      const focus = createPageFocus({ takesFocusOnArrival: true });
      focus.after(thisWeek, true);
      expect(focus.after(nextWeekByItself, false)).toBe('nowhere');
    });
  });

  describe('on the phone, which does not move focus when a screen opens (it would scroll the page)', () => {
    it('leaves it alone when the screen opens with focus elsewhere', () => {
      const focus = createPageFocus({ takesFocusOnArrival: false });
      expect(focus.after(week, false)).toBe('nowhere');
    });

    it('takes it only when it was lost, on opening and after every turn', () => {
      const focus = createPageFocus({ takesFocusOnArrival: false });
      expect(focus.after(week, true)).toBe('title');
      expect(focus.after(nextWeek, false)).toBe('nowhere');
      expect(focus.after(week, true)).toBe('title');
    });

    it('treats another view as a page turn: the control that changed it keeps focus', () => {
      const focus = createPageFocus({ takesFocusOnArrival: false });
      focus.after(week, false);
      expect(focus.after({ view: 'month', date: '2026-10-01', anchor: '2026-10-01' }, false)).toBe('nowhere');
      expect(focus.after({ view: 'week', date: '2026-10-04', anchor: '2026-10-04' }, true)).toBe('title');
    });
  });
});
