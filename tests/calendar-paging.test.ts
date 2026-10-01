import { describe, expect, it } from 'vitest';
import {
  addMonths,
  canOpenDay,
  clampToWindow,
  describePage,
  holdsToday,
  navigationRailDate,
  pageDays,
  pageStart,
  paging,
  pagingWindow,
  pagingWindowAround,
  parseWallRoute,
  shownDate,
  wallDate,
  wallPath,
  weekStart,
  type CalendarView,
  type WallRoute,
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

describe('describePage', () => {
  const now = new Date('2026-09-30T15:00:00Z');

  it('names a day and a week, with the year where the range crosses one', () => {
    expect(describePage(pageDays('day', '2026-09-30', CHICAGO, now))).toBe('Wed, Sep 30, 2026');
    expect(describePage(pageDays('week', '2026-09-27', CHICAGO, now))).toBe('Sep 27 to Oct 3, 2026');
    expect(describePage(pageDays('week', '2026-12-27', CHICAGO, now))).toBe('Dec 27, 2026 to Jan 2, 2027');
  });
});

describe('wall routes', () => {
  it('reads the view and the date from the address', () => {
    expect(parseWallRoute('/', '')).toEqual({ view: 'home' });
    expect(parseWallRoute('/week', '?date=2026-09-30')).toEqual({ view: 'week', date: '2026-09-30' });
    expect(parseWallRoute('/day', '?date=2026-10-02')).toEqual({ view: 'day', date: '2026-10-02' });
  });

  it('reads the Routines chart, which has no date to keep', () => {
    expect(parseWallRoute('/routines', '')).toEqual({ view: 'routines' });
    expect(parseWallRoute('/routines', '?date=2026-09-30')).toEqual({ view: 'routines' });
  });

  it('falls back to today for a missing or bad date', () => {
    expect(parseWallRoute('/week', '')).toEqual({ view: 'week', date: null });
    expect(parseWallRoute('/day', '?date=tomorrow')).toEqual({ view: 'day', date: null });
    expect(parseWallRoute('/day', '?date=2026-02-31')).toEqual({ view: 'day', date: null });
  });

  it('writes the address back', () => {
    expect(wallPath('week', '2026-09-27')).toBe('/week?date=2026-09-27');
  });
});

// Thu Oct 1, 2026, in the week of Sep 27 to Oct 3; the week of Oct 11 to 17 does not hold it. The
// paging window around it runs from Tue Sep 1, 2026 to Thu Apr 1, 2027, so the week of Aug 30 to
// Sep 5 and the week of Mar 28 to Apr 3 each straddle one end of it.
const TODAY = '2026-10-01';
const page = (view: CalendarView, date: string | null): WallRoute => ({ view, date });

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

describe('holdsToday', () => {
  it('is true on the home screen, which starts at today', () => {
    expect(holdsToday({ view: 'home' }, TODAY)).toBe(true);
  });

  it('is true for a week that holds today, whichever of its dates the address carries', () => {
    expect(holdsToday(page('week', '2026-09-27'), TODAY)).toBe(true);
    expect(holdsToday(page('week', '2026-09-30'), TODAY)).toBe(true);
    expect(holdsToday(page('week', '2026-10-03'), TODAY)).toBe(true);
    expect(holdsToday(page('week', '2026-12-27'), '2027-01-01')).toBe(true);
  });

  it('is false for a week that does not', () => {
    expect(holdsToday(page('week', '2026-09-20'), TODAY)).toBe(false);
    expect(holdsToday(page('week', '2026-10-04'), TODAY)).toBe(false);
  });

  it('is true for a day only when it is today', () => {
    expect(holdsToday(page('day', '2026-10-01'), TODAY)).toBe(true);
    expect(holdsToday(page('day', '2026-09-30'), TODAY)).toBe(false);
    expect(holdsToday(page('day', '2026-10-02'), TODAY)).toBe(false);
  });

  it('reads a page with no date as today\'s', () => {
    expect(holdsToday(page('week', null), TODAY)).toBe(true);
    expect(holdsToday(page('day', null), TODAY)).toBe(true);
  });

  it('is false for an address outside the window, which shows the page at the end of it', () => {
    expect(holdsToday(page('week', '2020-01-01'), TODAY)).toBe(false);
    expect(holdsToday(page('day', '2020-01-01'), TODAY)).toBe(false);
    expect(holdsToday(page('week', '2030-01-01'), TODAY)).toBe(false);
    expect(holdsToday(page('day', '2030-01-01'), TODAY)).toBe(false);
  });

  it('is true for a screen that is not a calendar view, such as the Routines chart', () => {
    expect(holdsToday({ view: 'routines' }, TODAY)).toBe(true);
  });
});

describe('wallDate', () => {
  it('is today on the home screen', () => {
    expect(wallDate({ view: 'home' }, TODAY)).toBe('2026-10-01');
  });

  it('is today, not the first day, on a page that holds today', () => {
    // The current week is anchored on its Sunday, but the wall is on today.
    expect(wallDate(page('week', '2026-09-27'), TODAY)).toBe('2026-10-01');
    expect(wallDate(page('day', '2026-10-01'), TODAY)).toBe('2026-10-01');
    expect(wallDate(page('week', null), TODAY)).toBe('2026-10-01');
  });

  it('is the first day of a page that does not hold today', () => {
    expect(wallDate(page('week', '2026-10-04'), TODAY)).toBe('2026-10-04');
    expect(wallDate(page('week', '2026-09-13'), TODAY)).toBe('2026-09-13');
    expect(wallDate(page('day', '2026-10-02'), TODAY)).toBe('2026-10-02');
    // An address that names a day in the middle of a week is still on that week's first day.
    expect(wallDate(page('week', '2026-10-14'), TODAY)).toBe('2026-10-11');
  });

  it('is on the page shown when the address is outside the window', () => {
    // Before the window the page shown is the one holding Sep 1, after it the one holding Apr 1.
    expect(wallDate(page('week', '2020-01-01'), TODAY)).toBe('2026-08-30');
    expect(wallDate(page('day', '2020-01-01'), TODAY)).toBe('2026-09-01');
    expect(wallDate(page('week', '2030-01-01'), TODAY)).toBe('2027-03-28');
    expect(wallDate(page('day', '2030-01-01'), TODAY)).toBe('2027-04-01');
  });

  it('is today on a screen that is not a calendar view, such as the Routines chart', () => {
    expect(wallDate({ view: 'routines' }, TODAY)).toBe('2026-10-01');
  });
});

describe('navigationRailDate', () => {
  it('opens today\'s page from the home screen', () => {
    expect(navigationRailDate('day', { view: 'home' }, TODAY)).toBe('2026-10-01');
    expect(navigationRailDate('week', { view: 'home' }, TODAY)).toBe('2026-09-27');
  });

  it('from a week that holds today, opens Day on today and Week on the same page', () => {
    expect(navigationRailDate('day', page('week', '2026-09-27'), TODAY)).toBe('2026-10-01');
    expect(navigationRailDate('week', page('week', '2026-09-27'), TODAY)).toBe('2026-09-27');
    expect(navigationRailDate('day', page('week', '2026-12-27'), '2027-01-01')).toBe('2027-01-01');
  });

  it('from a week that does not hold today, opens Day on that week\'s first day and Week on the same page', () => {
    expect(navigationRailDate('day', page('week', '2026-10-11'), TODAY)).toBe('2026-10-11');
    expect(navigationRailDate('week', page('week', '2026-10-11'), TODAY)).toBe('2026-10-11');
    expect(navigationRailDate('day', page('week', '2026-09-13'), TODAY)).toBe('2026-09-13');
    expect(navigationRailDate('day', page('week', '2026-10-14'), TODAY)).toBe('2026-10-11');
  });

  it('from the day that is today, opens Week on this week and Day on today', () => {
    expect(navigationRailDate('week', page('day', '2026-10-01'), TODAY)).toBe('2026-09-27');
    expect(navigationRailDate('day', page('day', '2026-10-01'), TODAY)).toBe('2026-10-01');
  });

  it('from a day that is not today, opens Week on the week holding it and Day on the same day', () => {
    expect(navigationRailDate('week', page('day', '2026-10-14'), TODAY)).toBe('2026-10-11');
    expect(navigationRailDate('day', page('day', '2026-10-14'), TODAY)).toBe('2026-10-14');
    // Yesterday is on this week too.
    expect(navigationRailDate('week', page('day', '2026-09-30'), TODAY)).toBe('2026-09-27');
  });

  it('reads a page with no date as today\'s', () => {
    expect(navigationRailDate('day', page('week', null), TODAY)).toBe('2026-10-01');
    expect(navigationRailDate('week', page('week', null), TODAY)).toBe('2026-09-27');
    expect(navigationRailDate('week', page('day', null), TODAY)).toBe('2026-09-27');
  });

  it('before the window, works on the page shown: the one holding the first day of the window', () => {
    // An address long before the window (Back into old history) shows the week of Aug 30 or Tue Sep 1.
    expect(navigationRailDate('day', page('week', '2020-01-01'), TODAY)).toBe('2026-09-01');
    expect(navigationRailDate('week', page('week', '2020-01-01'), TODAY)).toBe('2026-08-30');
    expect(navigationRailDate('day', page('day', '2020-01-01'), TODAY)).toBe('2026-09-01');
    expect(navigationRailDate('week', page('day', '2020-01-01'), TODAY)).toBe('2026-08-30');
  });

  it('after the window, works on the page shown: the one holding the last day of the window', () => {
    expect(navigationRailDate('day', page('week', '2030-01-01'), TODAY)).toBe('2027-03-28');
    expect(navigationRailDate('week', page('week', '2030-01-01'), TODAY)).toBe('2027-03-28');
    expect(navigationRailDate('day', page('day', '2030-01-01'), TODAY)).toBe('2027-04-01');
    expect(navigationRailDate('week', page('day', '2030-01-01'), TODAY)).toBe('2027-03-28');
  });

  it('leaving the Routines chart, which has no calendar date to keep, opens today\'s page', () => {
    expect(navigationRailDate('day', { view: 'routines' }, TODAY)).toBe('2026-10-01');
    expect(navigationRailDate('week', { view: 'routines' }, TODAY)).toBe('2026-09-27');
  });

  it('week to week and day to day are the same address, so a tap adds no step for Back', () => {
    // Including the weeks that straddle an end of the window, and the days at its ends.
    for (const date of ['2026-09-27', '2026-10-11', '2026-08-30', '2027-03-28']) {
      expect(wallPath('week', navigationRailDate('week', page('week', date), TODAY))).toBe(wallPath('week', date));
    }
    for (const date of ['2026-10-14', '2026-09-01', '2027-04-01']) {
      expect(wallPath('day', navigationRailDate('day', page('day', date), TODAY))).toBe(wallPath('day', date));
    }
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
