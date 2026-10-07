import { describe, expect, it } from 'vitest';
import {
  canOpenDay,
  cellLines,
  dayOccurrences,
  describeCell,
  describeMonth,
  formatCompactClock,
  isTightCell,
  linesPerCell,
  monthMinRem,
  monthWeeks,
  pagingWindow,
  type Occurrence,
  type WallDay,
} from '../src/lib/calendar-occurrences';
import { householdDay } from '../supabase/functions/_shared/zoned-time.ts';

const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';
const SANTIAGO = 'America/Santiago';
const LONDON = 'Europe/London';
const KOLKATA = 'Asia/Kolkata';

// Thu Oct 1, 2026, 10:00 in Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-01T15:00:00Z');
const TODAY = '2026-10-01';

let counter = 0;
function event(title: string, startsAt: string, endsAt: string, allDay = false): Occurrence {
  counter += 1;
  return {
    source: 'synced',
    id: `event-${counter}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    starts_at: startsAt,
    ends_at: endsAt,
    is_all_day: allDay,
    profile_id: null,
    profile_ids: [],
  };
}

const dates = (week: WallDay[]) => week.map((day) => day.date);
const hours = (day: WallDay) => (day.endMs - day.startMs) / 3_600_000;

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

describe('describeMonth', () => {
  it('names the month and year of its page', () => {
    expect(describeMonth('2026-10-01')).toBe('October 2026');
    expect(describeMonth('2026-12-01')).toBe('December 2026');
    expect(describeMonth('2027-01-01')).toBe('January 2027');
  });

  it('names the month whichever date of it is given, and is not moved by the machine zone', () => {
    expect(describeMonth('2026-10-31')).toBe('October 2026');
    // Midnight UTC on the 1st is still the month before in any zone behind UTC, so this reads the calendar date, not an instant.
    expect(describeMonth('2026-03-01')).toBe('March 2026');
  });
});

describe('the occurrences of a day', () => {
  // Sun Sep 27 to Sat Oct 3, 2026: Wednesday is Sep 30, Thursday Oct 1 and Friday Oct 2.
  const week = monthWeeks('2026-10-01', CHICAGO, TODAY)[0]!;
  const titlesOn = (occurrences: Occurrence[]) => week.map((day) => dayOccurrences(occurrences, day).map((occurrence) => occurrence.title));
  const thursday = week[4]!;

  it('puts all-day events first, then timed ones by start, then by title', () => {
    const occurrences = [
      event('Dentist', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'),
      event('Brunch', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'),
      event('Standup', '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z'),
      // A sleepover from Wednesday 22:00 started before any all-day event of Thursday did: all-day still comes first.
      event('Sleepover', '2026-10-01T03:00:00Z', '2026-10-01T13:00:00Z'),
      event('Zoo', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true),
      event('Birthday', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true),
      // Camping began on Tuesday, so of the all-day events it is first by start.
      event('Camping', '2026-09-29T05:00:00Z', '2026-10-02T05:00:00Z', true),
    ];
    expect(dayOccurrences(occurrences, thursday).map((occurrence) => occurrence.title)).toEqual([
      'Camping',
      'Birthday',
      'Zoo',
      'Sleepover',
      'Standup',
      'Brunch',
      'Dentist',
    ]);
  });

  it('does not reorder or change what it is given', () => {
    const occurrences = [event('B', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'), event('A', '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z')];
    const before = [...occurrences];
    dayOccurrences(occurrences, thursday);
    expect(occurrences).toEqual(before);
  });

  it('is empty on a day with nothing', () => {
    expect(dayOccurrences([event('Elsewhere', '2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z')], thursday)).toEqual([]);
    expect(dayOccurrences([], thursday)).toEqual([]);
  });

  it('puts a multi-day event on every day it covers', () => {
    // All-day Tue Sep 29 to Thu Oct 1: the end is the midnight after its last day.
    const camping = event('Camping', '2026-09-29T05:00:00Z', '2026-10-02T05:00:00Z', true);
    expect(titlesOn([camping])).toEqual([[], [], ['Camping'], ['Camping'], ['Camping'], [], []]);
    // Timed, 22:00 Wednesday to 08:00 Thursday.
    const sleepover = event('Sleepover', '2026-10-01T03:00:00Z', '2026-10-01T13:00:00Z');
    expect(titlesOn([sleepover])).toEqual([[], [], [], ['Sleepover'], ['Sleepover'], [], []]);
  });

  it('keeps an event that ends exactly at midnight out of the next day', () => {
    // 20:00 Wednesday to 00:00 Thursday.
    const late = event('Late', '2026-10-01T01:00:00Z', '2026-10-01T05:00:00Z');
    expect(titlesOn([late])).toEqual([[], [], [], ['Late'], [], [], []]);
  });

  it('keeps an all-day event to its own day: it ends at the next midnight', () => {
    const holiday = event('Holiday', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true);
    expect(titlesOn([holiday])).toEqual([[], [], [], [], ['Holiday'], [], []]);
  });

  it('puts an event that starts exactly at midnight on that day and not the one before', () => {
    const early = event('Early', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z');
    expect(titlesOn([early])).toEqual([[], [], [], [], ['Early'], [], []]);
  });

  it('puts an event of no length on the day it starts, midnight included', () => {
    const noon = event('Reminder', '2026-10-01T17:00:00Z', '2026-10-01T17:00:00Z');
    const midnight = event('Midnight reminder', '2026-10-02T05:00:00Z', '2026-10-02T05:00:00Z');
    expect(titlesOn([noon, midnight])).toEqual([[], [], [], [], ['Reminder'], ['Midnight reminder'], []]);
  });

  it('keeps a short event in a day\'s last quarter hour on that day only', () => {
    // Tuesday Sep 29, 23:50 to 23:55 CDT. The week view gives such an event 15 minutes so there is something
    // to tap, which would carry it past midnight; the month lists an event by what it really lasts.
    const lastMinutes = event('Last call', '2026-09-30T04:50:00Z', '2026-09-30T04:55:00Z');
    expect(titlesOn([lastMinutes])).toEqual([[], [], ['Last call'], [], [], [], []]);
  });

  it('keeps an event of no length at 23:59 on its own day', () => {
    const reminder = event('Reminder', '2026-09-30T04:59:00Z', '2026-09-30T04:59:00Z');
    expect(titlesOn([reminder])).toEqual([[], [], ['Reminder'], [], [], [], []]);
  });

  it('still puts a short event that really crosses midnight on both days', () => {
    // 23:55 Tuesday to 00:05 Wednesday.
    const across = event('Across', '2026-09-30T04:55:00Z', '2026-09-30T05:05:00Z');
    expect(titlesOn([across])).toEqual([[], [], ['Across'], ['Across'], [], [], []]);
  });

  it('follows the day lengths of a daylight saving change', () => {
    // Sunday 2026-11-01 is 25 hours long and 2026-03-08 is 23: an all-day event still fills its own day and no more.
    const fall = monthWeeks('2026-11-01', CHICAGO, TODAY)[0]!;
    const holiday = event('Holiday', '2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z', true);
    // 23:30 CST Sunday to 00:00 Monday CST.
    const night = event('Night', '2026-11-02T05:30:00Z', '2026-11-02T06:00:00Z');
    expect(fall.map((day) => dayOccurrences([holiday, night], day).map((occurrence) => occurrence.title))).toEqual([['Holiday', 'Night'], [], [], [], [], [], []]);
    const spring = monthWeeks('2026-03-01', CHICAGO, TODAY)[1]!;
    const springHoliday = event('Holiday', '2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z', true);
    expect(spring.map((day) => dayOccurrences([springHoliday], day).length)).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
});

describe('what a cell shows', () => {
  const some = (count: number) => ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, count).map((title) => event(title, '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z'));
  const shown = (occurrences: Occurrence[], lines: number) => cellLines(occurrences, lines).shown.map((occurrence) => occurrence.title);

  it('shows every occurrence when they fit', () => {
    const three = some(3);
    expect(cellLines(three, 3)).toEqual({ shown: three, more: null });
    expect(shown(three, 4)).toEqual(['A', 'B', 'C']);
    expect(shown(some(1), 1)).toEqual(['A']);
    expect(cellLines(some(1), 1).more).toBeNull();
    expect(cellLines([], 3)).toEqual({ shown: [], more: null });
  });

  it('shows all but one line\'s worth and "+N more" when they do not', () => {
    const three = cellLines(some(5), 3);
    expect(three.shown.map((occurrence) => occurrence.title)).toEqual(['A', 'B']);
    expect(three.more).toBe('+3 more');
    const four = cellLines(some(6), 4);
    expect(four.shown.map((occurrence) => occurrence.title)).toEqual(['A', 'B', 'C']);
    expect(four.more).toBe('+3 more');
  });

  it('counts the ones not shown, so the lines shown and N add up to the day', () => {
    for (const total of [3, 4, 5, 6]) {
      for (const lines of [2, 3]) {
        if (total <= lines) continue;
        const { shown: lineEvents, more } = cellLines(some(total), lines);
        expect(lineEvents).toHaveLength(lines - 1);
        expect(more).toBe(`+${total - (lines - 1)} more`);
      }
    }
  });

  it('with two lines shows the first occurrence and "+N more"', () => {
    expect(shown(some(3), 2)).toEqual(['A']);
    expect(cellLines(some(3), 2).more).toBe('+2 more');
    expect(shown(some(2), 2)).toEqual(['A', 'B']);
    expect(cellLines(some(2), 2).more).toBeNull();
  });

  it('with only one line says just how many there are', () => {
    expect(cellLines(some(2), 1)).toEqual({ shown: [], more: '2 events' });
    expect(cellLines(some(5), 1)).toEqual({ shown: [], more: '5 events' });
  });
});

describe('how many lines fit', () => {
  // 32 px above the first line (padding and the date), 24 px a line.
  const fit = (rowPx: number) => linesPerCell(rowPx, 32, 24);

  it('is the lines that fit under the date', () => {
    expect(fit(32 + 24 * 2)).toBe(2);
    expect(fit(32 + 24 * 3)).toBe(3);
    expect(fit(32 + 24 * 4)).toBe(4);
  });

  it('rounds down to a whole line', () => {
    expect(fit(32 + 24 * 3 - 1)).toBe(2);
    expect(fit(97.67)).toBe(2);
    expect(fit(116.9)).toBe(3);
  });

  it('fits fewer lines when the text is larger, a cell drawn in rem growing with the root font size', () => {
    // The month draws a cell as 2.25 rem above its lines and 1.5 rem for each, so both grow with the root size.
    const at = (rootPx: number) => linesPerCell(118, 2.25 * rootPx, 1.5 * rootPx);
    expect(at(16)).toBe(3);
    expect(at(20)).toBe(2);
    expect(at(24)).toBe(1);
    expect(at(32)).toBe(1);
  });

  it('is at least one, so a cell can always say how many events it holds', () => {
    expect(fit(32 + 24)).toBe(1);
    expect(fit(32 + 24 - 1)).toBe(1);
    expect(fit(32)).toBe(1);
    expect(fit(0)).toBe(1);
  });
});

// A day of the grid that canOpenDay refuses (its own tests are in calendar-paging.test.ts) is beyond the window.
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

describe('the time on a month line', () => {
  const at = (iso: string, timezone: string) => formatCompactClock(Date.parse(iso), timezone);

  it('drops ":00" on the hour and keeps the minutes otherwise', () => {
    expect(at('2026-09-29T15:00:00Z', CHICAGO)).toBe('10 AM');
    expect(at('2026-09-29T14:30:00Z', CHICAGO)).toBe('9:30 AM');
    expect(at('2026-09-29T14:05:00Z', CHICAGO)).toBe('9:05 AM');
    expect(at('2026-09-29T17:00:00Z', CHICAGO)).toBe('12 PM');
    expect(at('2026-09-30T05:00:00Z', CHICAGO)).toBe('12 AM');
    expect(at('2026-09-30T04:59:00Z', CHICAGO)).toBe('11:59 PM');
  });

  it('reads the time in the Household Timezone, minutes included', () => {
    // 15:30Z is half past ten in Chicago but on the hour in Kolkata (UTC+5:30), and 15:00Z is midnight in Tokyo.
    expect(at('2026-09-29T15:30:00Z', CHICAGO)).toBe('10:30 AM');
    expect(at('2026-09-29T15:30:00Z', KOLKATA)).toBe('9 PM');
    expect(at('2026-09-29T15:00:00Z', TOKYO)).toBe('12 AM');
  });
});

describe('what a screen reader hears of a cell', () => {
  it('gives the full date and how many events the day holds', () => {
    expect(describeCell('2026-10-01', 3)).toBe('Thursday, October 1, 3 events');
    expect(describeCell('2027-01-31', 12)).toBe('Sunday, January 31, 12 events');
  });

  it('says "no events" for an empty day and "1 event" for one', () => {
    expect(describeCell('2026-10-02', 0)).toBe('Friday, October 2, no events');
    expect(describeCell('2026-10-03', 1)).toBe('Saturday, October 3, 1 event');
  });

  it('gives only the date until the day has been read, so a day not yet known is never called free', () => {
    expect(describeCell('2026-10-01', null)).toBe('Thursday, October 1');
  });
});

// A six-week month at larger text (issue #69). On the 1280 x 800 Wall at 130 percent text (a root of 20.8 px) the grid has about 492 px under the
// people strip and paging row, 52 of them the weekday row. A date needs 2.625 rem and the line under it 1.5 rem, so six weeks of both need 567 px,
// 75 more than the room: a week the room leaves no line for is drawn as its date and a count beside it, and the month fits and does not scroll.
describe('a month at larger text', () => {
  const REM = 20.8;
  const HEAD = 2.625;
  const LINE = 1.5;
  const ROOM = 492;
  const WEEKDAYS = 2.5 * REM;
  const row = (weeks: number) => (ROOM - WEEKDAYS) / weeks;

  it('asks for the weekday row and a date for each week, and no line', () => {
    expect(monthMinRem(6, HEAD)).toBeCloseTo(2.5 + 6 * 2.625, 9);
    expect(monthMinRem(5, HEAD)).toBeCloseTo(2.5 + 5 * 2.625, 9);
    expect(monthMinRem(4, HEAD)).toBeCloseTo(2.5 + 4 * 2.625, 9);
  });

  it('fits six weeks in the room at a 20.8 px root, though a date and a line for each would not', () => {
    expect(monthMinRem(6, HEAD) * REM).toBeLessThan(ROOM);
    expect((2.5 + 6 * (HEAD + LINE)) * REM).toBeGreaterThan(ROOM);
    expect(isTightCell(row(6), HEAD * REM, LINE * REM, REM)).toBe(true);
    // The date fits its row, which is what tight cells are drawn with.
    expect(row(6)).toBeGreaterThan(HEAD * REM);
  });

  it('leaves five weeks as they are: a date and a line, not tight', () => {
    expect(isTightCell(row(5), HEAD * REM, LINE * REM, REM)).toBe(false);
    expect(linesPerCell(row(5), HEAD * REM, LINE * REM)).toBe(1);
    expect(isTightCell(row(4), HEAD * REM, LINE * REM, REM)).toBe(false);
  });

  it('is never tight at 16 px text, however short the row is, so a screen at 16 px is as it was', () => {
    expect(isTightCell(40, HEAD * 16, LINE * 16, 16)).toBe(false);
    expect(isTightCell(59, HEAD * 16, LINE * 16, 16)).toBe(false);
  });

  it('is tight at 200 percent text when the row has no room for a line under the date', () => {
    expect(isTightCell(110, HEAD * 32, LINE * 32, 32)).toBe(true);
    expect(isTightCell(140, HEAD * 32, LINE * 32, 32)).toBe(false);
  });
});
