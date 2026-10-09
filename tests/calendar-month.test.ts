import { describe, expect, it } from 'vitest';
import {
  cellLines,
  dayOccurrences,
  describeMonth,
  isTightCell,
  linesPerCell,
  monthMinRem,
  type Occurrence,
} from '../src/lib/calendar-occurrences';
import { monthWeeks } from '../src/lib/paged-view';

const CHICAGO = 'America/Chicago';

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
